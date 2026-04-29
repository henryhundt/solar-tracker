import type { Site } from "@shared/schema";
import { getAlsoEnergyBrowserSiteKey } from "@shared/alsoenergy";
import type { HistoryWindow } from "../history";
import type { Browser, Page } from "playwright";
import { launchScraperChromium } from "./playwright";

interface AlsoEnergyReading {
  siteId: number;
  timestamp: Date;
  energyWh: number;
  powerW: number;
}

interface PowerTrackChartPoint {
  x: number;
  y: number;
  timeStamp?: string | null;
}

interface PowerTrackChartSeries {
  name?: string;
  header?: string;
  customUnit?: string;
  units?: number | null;
  dataBinned?: Array<number | null>;
  dataXy?: PowerTrackChartPoint[];
}

interface PowerTrackChartResponse {
  series?: PowerTrackChartSeries[];
  message?: string | null;
}

interface PowerTrackQuarterHourSeries {
  bins: Array<number | null>;
  unit: "energy_kwh" | "power_kw";
}

interface PowerTrackHardwareSummaryResponse {
  hardware?: Array<{
    key?: string | null;
    name?: string | null;
    functionCode?: number | null;
    archiveColumns?: string[] | null;
  }>;
}

const POWERTRACK_URL = "https://apps.alsoenergy.com";
const LOGIN_URL = `${POWERTRACK_URL}/Account/Login`;
const API_LAST_CHANGED = "1900-01-01T00:00:00.000Z";
const CHART_HISTORY_DAYS = 30;
const QUARTERS_PER_HOUR = 4;
const HOURS_PER_DAY = 24;
const QUARTERS_PER_DAY = QUARTERS_PER_HOUR * HOURS_PER_DAY;
const QUARTER_HOUR_MS = 15 * 60 * 1000;
const USERNAME_SELECTORS =
  'input[name="username"], input#username, input[name="Username"], input#Username, input[type="email"]';
const PASSWORD_SELECTORS =
  'input[type="password"], input[name="password"], input[name="Password"], input#Password';
const SUBMIT_SELECTORS =
  'button[type="submit"], input[type="submit"], button:has-text("Continue"), button:has-text("Log in"), button:has-text("Sign in")';
const ERROR_SELECTORS =
  '.validation-summary-errors, .field-validation-error, .text-danger, .alert, .alert-danger, [role="alert"]';

export async function scrapeAlsoEnergyBrowser(
  site: Site,
  username: string,
  password: string,
  historyWindow?: HistoryWindow
): Promise<AlsoEnergyReading[]> {
  console.log(`[AlsoEnergy Browser] Starting browser scrape for ${site.name}`);

  let browser: Browser | null = null;

  try {
    browser = await launchScraperChromium();

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();

    await loginToPowerTrack(page, username, password);
    await navigateToSite(page, site.siteIdentifier);
    const readings = await extractEnergyData(page, site, historyWindow);

    console.log(`[AlsoEnergy Browser] Retrieved ${readings.length} readings for ${site.name}`);
    return readings;
  } catch (error: any) {
    console.error(`[AlsoEnergy Browser] Error scraping ${site.name}:`, error.message);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

async function loginToPowerTrack(page: Page, username: string, password: string): Promise<void> {
  console.log(`[AlsoEnergy Browser] Navigating to login page: ${LOGIN_URL}`);

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  console.log(`[AlsoEnergy Browser] Landed on login page: ${page.url()}`);

  console.log(`[AlsoEnergy Browser] Entering username...`);
  await page.waitForSelector(USERNAME_SELECTORS, { timeout: 20000, state: "visible" });
  await page.locator(USERNAME_SELECTORS).first().fill(username);

  const passwordAlreadyVisible = await isSelectorVisible(page, PASSWORD_SELECTORS);
  if (!passwordAlreadyVisible) {
    console.log(`[AlsoEnergy Browser] Waiting for password step...`);
    await clickSubmit(page, "Could not find Continue button on login page");
    await page.waitForSelector(PASSWORD_SELECTORS, { timeout: 15000, state: "visible" });
  }

  console.log(`[AlsoEnergy Browser] Entering password...`);
  await page.locator(PASSWORD_SELECTORS).first().fill(password);
  await clickSubmit(page);

  console.log(`[AlsoEnergy Browser] Waiting for login to complete...`);

  try {
    await page.waitForURL((url) => isAuthenticatedPowerTrackUrl(url.toString()), { timeout: 30000 });
    console.log(`[AlsoEnergy Browser] Login successful, redirected to: ${page.url()}`);
  } catch {
    const errorText = await page.locator(ERROR_SELECTORS).first().textContent().catch(() => null);
    if (errorText?.trim()) {
      throw new Error(`Login failed: ${errorText.trim()}`);
    }

    const currentUrl = page.url();
    if (isLoginPageUrl(currentUrl)) {
      throw new Error("Login failed: Still on the login page after submitting credentials. Check your username, password, and SSO requirements.");
    }
    console.log(`[AlsoEnergy Browser] Login may have succeeded, current URL: ${currentUrl}`);
  }
}

async function navigateToSite(page: Page, siteIdentifier: string | null): Promise<void> {
  await page.waitForTimeout(2000);

  const browserSiteKey = getAlsoEnergyBrowserSiteKey({ siteIdentifier });
  if (!browserSiteKey) {
    console.log(`[AlsoEnergy Browser] No site identifier, using current page`);
    return;
  }

  // Site keys are like "S41121" — navigate directly to /powertrack/{key}
  const siteUrl = `${POWERTRACK_URL}/powertrack/${browserSiteKey}`;
  console.log(`[AlsoEnergy Browser] Navigating to site: ${siteUrl}`);

  try {
    await page.goto(siteUrl, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(3000);
    const url = page.url();
    if (!url.includes("/Account/Login") && !url.includes("/Error")) {
      console.log(`[AlsoEnergy Browser] Successfully navigated to site at: ${url}`);
      return;
    }
  } catch (err: any) {
    console.log(`[AlsoEnergy Browser] Direct navigation failed: ${err.message}`);
  }

  console.log(`[AlsoEnergy Browser] Could not navigate to specific site, using current page`);
}

async function extractEnergyData(
  page: Page,
  site: Site,
  historyWindow?: HistoryWindow
): Promise<AlsoEnergyReading[]> {
  console.log(`[AlsoEnergy Browser] Extracting energy data...`);

  const siteKey = getAlsoEnergyBrowserSiteKey(site);
  if (siteKey && historyWindow) {
    try {
      const chartReadings = await fetchChartHistory(page, site, siteKey, historyWindow);
      if (chartReadings.length > 0) {
        console.log(`[AlsoEnergy Browser] Got ${chartReadings.length} hourly reading(s) from chart API`);
        return chartReadings;
      }
    } catch (error: any) {
      console.warn(`[AlsoEnergy Browser] Chart API history fallback failed: ${error.message}`);
    }
  } else if (historyWindow) {
    console.warn(
      `[AlsoEnergy Browser] History window ${historyWindow.start.toISOString()} -> ${historyWindow.end.toISOString()} requested, but no PowerTrack site key is available for chart history.`
    );
  } else {
    console.warn(
      `[AlsoEnergy Browser] Browser fallback is using summary endpoints because no history window was provided.`
    );
  }

  // Intercept the /api/production/{key} response which contains yesterday + today kWh
  const productionData = await new Promise<any | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 15000);

    page.on("response", async (response) => {
      const url = response.url();
      const matchedProductionEndpoint = siteKey
        ? url.includes(`/api/production/${siteKey}`)
        : /\/api\/production\/S\d+/i.test(url);

      if (matchedProductionEndpoint) {
        clearTimeout(timeout);
        try {
          const data = await response.json();
          resolve(data);
        } catch {
          resolve(null);
        }
      }
    });

    // Trigger a page reload to fire the production API call
    page.reload({ waitUntil: "load" }).catch(() => {});
  });

  if (productionData) {
    const readings: AlsoEnergyReading[] = [];

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);

    const today = new Date();
    today.setHours(12, 0, 0, 0);

    if (typeof productionData.yesterday === "number" && productionData.yesterday > 0) {
      const energyWh = Math.round(productionData.yesterday * 1000);
      readings.push({ siteId: site.id, timestamp: yesterday, energyWh, powerW: Math.round(energyWh / 12) });
      console.log(`[AlsoEnergy Browser] Yesterday: ${productionData.yesterday} kWh`);
    }

    if (typeof productionData.today === "number" && productionData.today > 0) {
      const energyWh = Math.round(productionData.today * 1000);
      readings.push({ siteId: site.id, timestamp: today, energyWh, powerW: Math.round(energyWh / 12) });
      console.log(`[AlsoEnergy Browser] Today so far: ${productionData.today} kWh`);
    }

    if (readings.length > 0) {
      console.log(`[AlsoEnergy Browser] Got ${readings.length} readings from production API`);
      return readings;
    }
  }

  // Fallback: DOM scraping
  console.log(`[AlsoEnergy Browser] Production API did not return data, falling back to DOM`);
  const dailyKwh = await extractDailyTotal(page);
  if (dailyKwh !== null) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    console.log(`[AlsoEnergy Browser] Got daily total from DOM: ${dailyKwh} Wh`);
    return [{ siteId: site.id, timestamp: yesterday, energyWh: dailyKwh, powerW: Math.round(dailyKwh / 12) }];
  }

  console.log(`[AlsoEnergy Browser] No energy data found`);
  return [];
}

async function fetchChartHistory(
  page: Page,
  site: Site,
  siteKey: string,
  historyWindow: HistoryWindow
): Promise<AlsoEnergyReading[]> {
  const normalizedWindow = normalizeHistoryWindow(historyWindow);
  if (!normalizedWindow) {
    console.log("[AlsoEnergy Browser] Requested browser history window does not include a completed hour.");
    return [];
  }

  const productionMeterKeys = await fetchProductionMeterKeys(page, siteKey);
  const fallbackHardwareKeys = await fetchSiteAggregateHardwareKeys(page, siteKey);

  if (productionMeterKeys.length === 0 && fallbackHardwareKeys.length === 0) {
    throw new Error("No hardware keys were available for browser chart history.");
  }

  if (productionMeterKeys.length > 0) {
    console.log(
      `[AlsoEnergy Browser] Using ${productionMeterKeys.length} production meter(s) for browser chart history.`
    );
  } else {
    console.warn(
      `[AlsoEnergy Browser] No production meter hardware was available for ${site.name}; falling back to site aggregate chart history.`
    );
  }

  const readingsByTimestamp = new Map<number, AlsoEnergyReading>();

  for (const chunk of chunkDateRange(normalizedWindow.startInclusive, normalizedWindow.endExclusive, CHART_HISTORY_DAYS)) {
    const startDate = formatLocalDate(chunk.start);
    const endDate = formatLocalDate(chunk.end);
    console.log(`[AlsoEnergy Browser] Fetching chart history ${startDate} -> ${endDate} for ${site.name}`);

    const [dailyAnchorsChart, powerChart] = await Promise.all([
      fetchPowerTrackJson<PowerTrackChartResponse>(page, "/api/view/chart", {
        method: "POST",
        body: {
          binSize: null,
          context: "site",
          start: startDate,
          end: endDate,
          sectionCode: -1,
          query: null,
          chartType: 255,
          source: [siteKey],
        },
      }),
      fetchPreferredPowerChart(
        page,
        siteKey,
        startDate,
        endDate,
        productionMeterKeys,
        fallbackHardwareKeys
      ),
    ]);

    const chunkReadings = buildReadingsFromChartChunk(
      site.id,
      dailyAnchorsChart,
      powerChart,
      normalizedWindow
    );

    for (const reading of chunkReadings) {
      readingsByTimestamp.set(reading.timestamp.getTime(), reading);
    }
  }

  return Array.from(readingsByTimestamp.values()).sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime()
  );
}

async function fetchProductionMeterKeys(page: Page, siteKey: string): Promise<string[]> {
  const response = await fetchPowerTrackJson<PowerTrackHardwareSummaryResponse>(
    page,
    "/api/view/sitehardware",
    {
      method: "POST",
      body: {
        key: siteKey,
        includeRegistersFromHardware: [],
      },
    }
  );

  const keys = (response.hardware ?? [])
    .filter((hardware) => hardware.functionCode === 2)
    .map((hardware) => hardware.key?.trim())
    .filter((key): key is string => Boolean(key));

  return Array.from(new Set(keys));
}

async function fetchSiteAggregateHardwareKeys(page: Page, siteKey: string): Promise<string[]> {
  const response = await fetchPowerTrackJson<PowerTrackHardwareSummaryResponse>(
    page,
    `/api/view/sitehardwareproduction/${siteKey}`
  );

  const keys = (response.hardware ?? [])
    .map((hardware) => hardware.key?.trim())
    .filter((key): key is string => Boolean(key));

  return Array.from(new Set(keys));
}

async function fetchPreferredPowerChart(
  page: Page,
  siteKey: string,
  startDate: string,
  endDate: string,
  productionMeterKeys: string[],
  fallbackHardwareKeys: string[]
): Promise<PowerTrackChartResponse> {
  if (productionMeterKeys.length > 0) {
    try {
      const productionMeterChart = await fetchPowerTrackJson<PowerTrackChartResponse>(
        page,
        "/api/view/chart",
        {
          method: "POST",
          body: {
            chartType: 15,
            binSize: 15,
            context: "site",
            start: startDate,
            end: endDate,
            futureDays: 0,
            hardwareSet: productionMeterKeys,
            sectionCode: 2,
            query: null,
            source: [siteKey],
          },
        }
      );

      if (getQuarterHourSeries(productionMeterChart)?.bins.length) {
        return productionMeterChart;
      }

      console.warn(
        `[AlsoEnergy Browser] Production meter chart returned no usable production bins for ${siteKey} ${startDate} -> ${endDate}; falling back to site aggregate chart.`
      );
    } catch (error: any) {
      console.warn(
        `[AlsoEnergy Browser] Production meter chart request failed for ${siteKey} ${startDate} -> ${endDate}: ${error.message}`
      );
    }
  }

  if (fallbackHardwareKeys.length === 0) {
    throw new Error("No fallback site hardware was available for browser chart history.");
  }

  return fetchPowerTrackJson<PowerTrackChartResponse>(page, "/api/view/chart", {
    method: "POST",
    body: {
      chartType: 172,
      binSize: 15,
      context: "site",
      start: startDate,
      end: endDate,
      futureDays: 0,
      hardwareSet: fallbackHardwareKeys,
      sectionCode: 2,
      source: [siteKey],
    },
  });
}

function buildReadingsFromChartChunk(
  dbSiteId: number,
  dailyAnchorsChart: PowerTrackChartResponse,
  powerChart: PowerTrackChartResponse,
  window: { startInclusive: Date; endExclusive: Date }
): AlsoEnergyReading[] {
  const dayStarts = getDailyAnchorTimestamps(dailyAnchorsChart);
  const quarterHourSeries = getQuarterHourSeries(powerChart);
  if (dayStarts.length === 0 || !quarterHourSeries || quarterHourSeries.bins.length === 0) {
    return [];
  }

  const daysAvailable = Math.min(dayStarts.length, Math.floor(quarterHourSeries.bins.length / QUARTERS_PER_DAY));
  const readings: AlsoEnergyReading[] = [];

  for (let dayIndex = 0; dayIndex < daysAvailable; dayIndex += 1) {
    const dayStart = dayStarts[dayIndex];

    for (let hourIndex = 0; hourIndex < HOURS_PER_DAY; hourIndex += 1) {
      const quarterStart = dayIndex * QUARTERS_PER_DAY + hourIndex * QUARTERS_PER_HOUR;
      const hourBins = quarterHourSeries.bins.slice(quarterStart, quarterStart + QUARTERS_PER_HOUR);
      const validBins = hourBins.filter((value): value is number => typeof value === "number" && Number.isFinite(value));

      if (validBins.length === 0) {
        continue;
      }

      const timestamp = new Date(dayStart + hourIndex * 60 * 60 * 1000);
      if (timestamp < window.startInclusive || timestamp >= window.endExclusive) {
        continue;
      }

      const totalEnergyWh = quarterHourSeries.unit === "energy_kwh"
        ? validBins.reduce((sum, value) => sum + Math.max(0, value) * 1000, 0)
        : validBins.reduce((sum, value) => sum + Math.max(0, value) * 250, 0);
      const averagePowerW = quarterHourSeries.unit === "energy_kwh"
        ? Math.round(totalEnergyWh)
        : validBins.reduce((sum, value) => sum + Math.max(0, value), 0) / validBins.length * 1000;

      if (totalEnergyWh <= 0 && averagePowerW <= 0) {
        continue;
      }

      readings.push({
        siteId: dbSiteId,
        timestamp,
        energyWh: Math.round(totalEnergyWh),
        powerW: Math.round(averagePowerW),
      });
    }
  }

  return readings;
}

function getDailyAnchorTimestamps(chart: PowerTrackChartResponse): number[] {
  for (const series of chart.series ?? []) {
    if (Array.isArray(series.dataXy) && series.dataXy.length > 0) {
      return series.dataXy
        .map((point) => point.x)
        .filter((value): value is number => Number.isFinite(value));
    }
  }

  return [];
}

function getQuarterHourSeries(chart: PowerTrackChartResponse): PowerTrackQuarterHourSeries | null {
  const relevantSeries = (chart.series ?? []).filter((series) =>
    Array.isArray(series.dataBinned) &&
    series.dataBinned.length > 0 &&
    !isEstimateSeries(series)
  );

  const energySeries = relevantSeries.filter((series) =>
    (series.customUnit ?? "").toLowerCase().includes("kilowatt hours") ||
    series.units === 11
  );
  if (energySeries.length > 0) {
    return {
      bins: aggregateBinnedSeries(energySeries),
      unit: "energy_kwh",
    };
  }

  const powerSeries = relevantSeries.filter((series) =>
    (
      (series.customUnit ?? "").toLowerCase().includes("kilowatts") ||
      series.units === 10
    )
  );
  if (powerSeries.length > 0) {
    return {
      bins: aggregateBinnedSeries(powerSeries),
      unit: "power_kw",
    };
  }

  return null;
}

function aggregateBinnedSeries(seriesList: PowerTrackChartSeries[]): Array<number | null> {
  const longestSeriesLength = Math.max(...seriesList.map((series) => series.dataBinned?.length ?? 0));

  return Array.from({ length: longestSeriesLength }, (_, index) => {
    let total = 0;
    let hasValue = false;

    for (const series of seriesList) {
      const value = series.dataBinned?.[index];
      if (typeof value === "number" && Number.isFinite(value)) {
        total += Math.max(0, value);
        hasValue = true;
      }
    }

    return hasValue ? total : null;
  });
}

function isEstimateSeries(series: PowerTrackChartSeries): boolean {
  const label = `${series.name ?? ""} ${series.header ?? ""}`.toLowerCase();
  return label.includes("estimate");
}

function normalizeHistoryWindow(historyWindow: HistoryWindow): { startInclusive: Date; endExclusive: Date } | null {
  const startInclusive = new Date(historyWindow.start);
  const endExclusive = new Date(historyWindow.end);
  endExclusive.setMinutes(0, 0, 0);

  if (endExclusive <= startInclusive) {
    return null;
  }

  return {
    startInclusive,
    endExclusive,
  };
}

async function fetchPowerTrackJson<T>(
  page: Page,
  path: string,
  options?: {
    method?: "GET" | "POST";
    body?: unknown;
  }
): Promise<T> {
  const method = options?.method ?? "GET";
  const body = options?.body ? JSON.stringify(options.body) : null;

  const result = await page.evaluate(
    async ({ path, method, body, lastChanged }) => {
      const response = await fetch(`${path}?lastChanged=${encodeURIComponent(lastChanged)}`, {
        method,
        headers: body
          ? {
              "Content-Type": "application/json",
            }
          : undefined,
        body,
        credentials: "include",
      });

      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        text,
      };
    },
    {
      path,
      method,
      body,
      lastChanged: API_LAST_CHANGED,
    }
  );

  if (!result.ok) {
    throw new Error(`PowerTrack request failed (${result.status}) for ${path}: ${result.text.slice(0, 400)}`);
  }

  return JSON.parse(result.text) as T;
}

function chunkDateRange(
  start: Date,
  endExclusive: Date,
  chunkDays: number
): Array<{ start: Date; end: Date }> {
  const chunks: Array<{ start: Date; end: Date }> = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);

  const endBoundary = new Date(endExclusive);
  endBoundary.setHours(0, 0, 0, 0);
  if (endExclusive > endBoundary) {
    endBoundary.setDate(endBoundary.getDate() + 1);
  }

  while (cursor < endBoundary) {
    const chunkStart = new Date(cursor);
    const chunkEndExclusive = new Date(cursor);
    chunkEndExclusive.setDate(chunkEndExclusive.getDate() + chunkDays);
    if (chunkEndExclusive > endBoundary) {
      chunkEndExclusive.setTime(endBoundary.getTime());
    }

    const chunkEnd = new Date(chunkEndExclusive);
    chunkEnd.setDate(chunkEnd.getDate() - 1);
    chunks.push({ start: chunkStart, end: chunkEnd });
    cursor.setTime(chunkEndExclusive.getTime());
  }

  return chunks;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function extractDailyTotal(page: Page): Promise<number | null> {
  const selectors = [
    '[class*="production"] [class*="value"]',
    '[class*="energy"] [class*="value"]',
    '[class*="generation"]',
    '[data-field*="energy"]',
    ".site-summary .value",
    ".kWh",
    ".kwh",
  ];

  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        const text = await el.textContent();
        if (text) {
          const match = text.match(/([\d,]+\.?\d*)/);
          if (match) {
            const value = parseFloat(match[1].replace(/,/g, ""));
            if (!isNaN(value) && value > 0) {
              if (text.toLowerCase().includes("mwh")) return Math.round(value * 1_000_000);
              if (text.toLowerCase().includes("kwh")) return Math.round(value * 1000);
              if (value > 100) return Math.round(value);
              return Math.round(value * 1000);
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

async function isSelectorVisible(page: Page, selector: string): Promise<boolean> {
  try {
    return await page.locator(selector).first().isVisible();
  } catch {
    return false;
  }
}

async function clickSubmit(page: Page, missingButtonError = "Could not find submit button on login page"): Promise<void> {
  const submitControl = page.locator(SUBMIT_SELECTORS).first();

  if (await submitControl.isVisible().catch(() => false)) {
    await submitControl.click();
    return;
  }

  if (await isSelectorVisible(page, PASSWORD_SELECTORS)) {
    await page.locator(PASSWORD_SELECTORS).first().press("Enter");
    return;
  }

  throw new Error(missingButtonError);
}

function isAuthenticatedPowerTrackUrl(url: string): boolean {
  return /apps\.alsoenergy\.com/i.test(url) && !/apps\.alsoenergy\.com\/callback/i.test(url) && !isLoginPageUrl(url);
}

function isLoginPageUrl(url: string): boolean {
  return /login\.stem\.com|idp\.alsoenergy\.com|apps\.alsoenergy\.com\/Account\//i.test(url);
}

export async function discoverAlsoEnergyBrowserSites(
  username: string,
  password: string
): Promise<Array<{ siteId: string; siteName: string }>> {
  console.log(`[AlsoEnergy Browser] Discovering sites for account...`);

  let browser: Browser | null = null;

  try {
    browser = await launchScraperChromium();

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();

    await loginToPowerTrack(page, username, password);
    await page.waitForTimeout(3000);

    // Extract site links matching /powertrack/S{digits} pattern from the nav sidebar
    const links = await page.$$eval("a[href*='/powertrack/S']", (els) =>
      els.map((el) => ({
        href: (el as HTMLAnchorElement).href,
        text: el.textContent?.trim() || "",
      }))
    );

    const seenKeys = new Set<string>();
    const discoveredSites: Array<{ siteId: string; siteName: string }> = [];

    for (const link of links) {
      const match = link.href.match(/\/powertrack\/(S\d+)/i);
      if (match) {
        const key = match[1];
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          discoveredSites.push({ siteId: key, siteName: link.text || key });
        }
      }
    }

    console.log(`[AlsoEnergy Browser] Discovered ${discoveredSites.length} sites`);
    return discoveredSites;
  } finally {
    if (browser) await browser.close();
  }
}
