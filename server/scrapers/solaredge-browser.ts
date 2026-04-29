import type { Site } from "@shared/schema";
import type { HistoryWindow } from "../history";
import type { APIRequestContext, Browser, Page } from "playwright";
import { launchScraperChromium } from "./playwright";
import type { SolarEdgeDiscoveredSite } from "./solaredge-api";

interface SolarEdgeReading {
  siteId: number;
  timestamp: Date;
  energyWh: number;
  powerW: number;
}

interface SolarEdgeSiteSearchResponse {
  totalSitesInSearch?: number;
  numberOfSitesInSearch?: number;
  page?: Array<{
    solarFieldId?: number | string | null;
    name?: string | null;
  }>;
}

interface SolarEdgeDashboardEnergyResponse {
  chart?: {
    measurements?: Array<{
      measurementTime?: string;
      production?: number | null;
    }>;
  };
}

interface SolarEdgeDashboardPowerResponse {
  measurements?: Array<{
    measurementTime?: string;
    production?: number | null;
  }>;
}

const SOLAREDGE_MONITORING_URL = "https://monitoring.solaredge.com";
const SOLAREDGE_BROWSER_SEARCH_PAGE_SIZE = 20;
const SOLAREDGE_BROWSER_DAILY_CHUNK_DAYS = 120;
const SOLAREDGE_BROWSER_HIGH_RES_DAYS = 3;
const SOLAREDGE_BROWSER_HIGH_RES_CHUNK_DAYS = 3;

export async function scrapeSolarEdgeBrowser(
  site: Site,
  username: string,
  password: string,
  historyWindow?: HistoryWindow
): Promise<SolarEdgeReading[]> {
  console.log(`[SolarEdge Browser] Starting browser scrape for ${site.name}`);
  
  let browser: Browser | null = null;
  
  try {
    browser = await launchScraperChromium();
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 }
    });
    
    const page = await context.newPage();
    
    await login(page, username, password);
    await page.waitForTimeout(3000);

    const browserSite = await resolveSolarEdgeBrowserSite(page, site.siteIdentifier || site.name);
    console.log(`[SolarEdge Browser] Resolved site ${browserSite.siteId} (${browserSite.siteName})`);

    let readings: SolarEdgeReading[];
    try {
      readings = await extractEnergyDataFromDashboardApis(
        page.context().request,
        site,
        browserSite.siteId,
        historyWindow
      );
    } catch (error: any) {
      console.log(`[SolarEdge Browser] Dashboard API extraction failed, falling back to page scraping: ${error.message}`);
      await navigateToSite(page, browserSite.siteId);
      readings = await extractEnergyData(page, site);
    }

    const filteredReadings = filterReadingsToWindow(readings, historyWindow);
    
    if (historyWindow && historyWindow.start < new Date(Date.now() - SOLAREDGE_BROWSER_HIGH_RES_DAYS * 24 * 60 * 60 * 1000)) {
      console.log("[SolarEdge Browser] Older browser history is sourced from daily dashboard totals; recent production uses quarter-hour dashboard power data.");
    }

    console.log(`[SolarEdge Browser] Retrieved ${filteredReadings.length} readings for ${site.name}`);
    
    return filteredReadings;
    
  } catch (error: any) {
    console.error(`[SolarEdge Browser] Error scraping ${site.name}:`, error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function login(page: Page, username: string, password: string): Promise<void> {
  console.log(`[SolarEdge Browser] Navigating to login page...`);
  
  await page.goto(`${SOLAREDGE_MONITORING_URL}/solaredge-web/p/login`, {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  const usernameFieldSelector = 'input[name="username"], input[name="j_username"], input[type="email"], #username';
  const passwordFieldSelector = 'input[name="password"], input[name="j_password"], input[type="password"], #password';

  await revealCredentialFormIfNeeded(page, usernameFieldSelector);

  const usernameSelector = page.locator(usernameFieldSelector).first();
  const passwordSelector = page.locator(passwordFieldSelector).first();

  if ((await usernameSelector.count()) === 0 || (await passwordSelector.count()) === 0) {
    throw new Error("Could not find login form fields");
  }
  
  console.log(`[SolarEdge Browser] Entering credentials...`);
  
  await usernameSelector.fill(username);
  await passwordSelector.fill(password);

  const submitButton = await findVisibleLoginSubmitButton(page);
  if (submitButton) {
    await submitButton.click();
  } else {
    await passwordSelector.press('Enter');
  }
  
  console.log(`[SolarEdge Browser] Waiting for login to complete...`);
  
  try {
    await page.waitForURL(/.*\/solaredge-web\/p\/site\/|.*dashboard|.*monitoring/i, {
      timeout: 15000
    });
    console.log(`[SolarEdge Browser] Login successful`);
  } catch (error) {
    const errorMessage = await page.$('.error-message, .login-error, [class*="error"]');
    if (errorMessage) {
      const errorText = await errorMessage.textContent();
      throw new Error(`Login failed: ${errorText}`);
    }
    throw new Error("Login failed: Could not navigate to dashboard after login");
  }
}

async function revealCredentialFormIfNeeded(page: Page, usernameFieldSelector: string): Promise<void> {
  const usernameField = page.locator(usernameFieldSelector).first();
  if ((await usernameField.count()) > 0) {
    return;
  }

  const loginButtons = [
    page.getByRole("button", { name: /^log in$/i }).first(),
    page.locator("button").filter({ hasText: /^log in$/i }).first(),
  ];

  for (const button of loginButtons) {
    if ((await button.count()) === 0) {
      continue;
    }

    try {
      console.log("[SolarEdge Browser] Opening the current login form...");
      await button.click();
      await page.waitForLoadState("networkidle");
      break;
    } catch (_error) {
      // Try the next candidate if this click path is no longer valid.
    }
  }

  await page.waitForSelector(usernameFieldSelector, {
    timeout: 15000,
  });
}

async function findVisibleLoginSubmitButton(page: Page) {
  const candidates = [
    page.getByRole("button", { name: /sign in|log in/i }).first(),
    page.locator('button[type="submit"]').first(),
    page.locator('input[type="submit"]').first(),
    page.locator('[data-testid="login-button"]').first(),
    page.locator('.login-button').first(),
  ];

  for (const candidate of candidates) {
    if ((await candidate.count()) === 0) {
      continue;
    }

    try {
      if (await candidate.isVisible()) {
        return candidate;
      }
    } catch (_error) {
      // Ignore detached candidates and try the next one.
    }
  }

  return null;
}

async function navigateToSite(page: Page, siteIdentifier: string | null): Promise<string> {
  const browserSite = await resolveSolarEdgeBrowserSite(page, siteIdentifier);
  const siteUrl = `${SOLAREDGE_MONITORING_URL}/one#/residential/dashboard?siteId=${browserSite.siteId}`;

  console.log(`[SolarEdge Browser] Navigating to site: ${browserSite.siteId} (${browserSite.siteName})`);
  await page.goto(siteUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(5000);
  return page.url();
}

async function extractEnergyData(page: Page, site: Site): Promise<SolarEdgeReading[]> {
  console.log(`[SolarEdge Browser] Extracting energy data...`);
  
  const readings: SolarEdgeReading[] = [];
  
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const targetDateCopy = new Date(yesterday.getTime());
  
  try {
    const apiData = await extractFromNetworkRequests(page, site, targetDateCopy);
    if (apiData.length > 0) {
      return apiData;
    }
  } catch (error) {
    console.log(`[SolarEdge Browser] Could not extract from network, trying DOM...`);
  }
  
  try {
    const domData = await extractFromDOM(page, site, new Date(yesterday.getTime()));
    if (domData.length > 0) {
      return domData;
    }
  } catch (error) {
    console.log(`[SolarEdge Browser] Could not extract from DOM, trying chart data...`);
  }
  
  try {
    const chartData = await extractFromChartElements(page, site, new Date(yesterday.getTime()));
    if (chartData.length > 0) {
      return chartData;
    }
  } catch (error) {
    console.log(`[SolarEdge Browser] Could not extract chart data`);
  }
  
  const dailyEnergy = await extractDailyTotal(page);
  if (dailyEnergy !== null) {
    const noonTimestamp = new Date(yesterday.getTime());
    noonTimestamp.setHours(12, 0, 0, 0);
    readings.push({
      siteId: site.id,
      timestamp: noonTimestamp,
      energyWh: dailyEnergy,
      powerW: Math.round(dailyEnergy / 12)
    });
  }
  
  return readings;
}

async function extractFromNetworkRequests(
  page: Page,
  site: Site,
  targetDate: Date
): Promise<SolarEdgeReading[]> {
  const readings: SolarEdgeReading[] = [];
  const capturedResponses: any[] = [];
  
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/energy') || url.includes('/power') || url.includes('/chart')) {
      try {
        const data = await response.json();
        capturedResponses.push(data);
      } catch (e) {
      }
    }
  });
  
  const energyTabs = await page.$$('[class*="energy"], [data-tab="energy"], a[href*="energy"]');
  for (const tab of energyTabs) {
    try {
      await tab.click();
      await page.waitForTimeout(2000);
      break;
    } catch (e) {
    }
  }
  
  await page.waitForTimeout(3000);
  
  if (capturedResponses.length === 0) {
    console.log(`[SolarEdge Browser] No API responses captured, trying page reload...`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
  }
  
  for (const data of capturedResponses) {
    if (data.energy?.values) {
      for (const value of data.energy.values) {
        if (value.date && value.value !== null) {
          readings.push({
            siteId: site.id,
            timestamp: new Date(value.date),
            energyWh: value.value,
            powerW: value.value
          });
        }
      }
    }
    
    if (data.power?.values) {
      for (const value of data.power.values) {
        if (value.date && value.value !== null && !readings.find(r => r.timestamp.getTime() === new Date(value.date).getTime())) {
          const ts = new Date(value.date);
          readings.push({
            siteId: site.id,
            timestamp: ts,
            energyWh: value.value,
            powerW: value.value
          });
        }
      }
    }
  }
  
  console.log(`[SolarEdge Browser] Captured ${readings.length} readings from network requests`);
  return readings;
}

function filterReadingsToWindow(
  readings: SolarEdgeReading[],
  historyWindow?: HistoryWindow
): SolarEdgeReading[] {
  if (!historyWindow) {
    return readings;
  }

  return readings.filter((reading) => (
    reading.timestamp >= historyWindow.start &&
    reading.timestamp <= historyWindow.end
  ));
}

async function extractFromDOM(
  page: Page,
  site: Site,
  targetDate: Date
): Promise<SolarEdgeReading[]> {
  const readings: SolarEdgeReading[] = [];
  
  const energyValues = await page.$$eval(
    '[class*="energy"], [class*="production"], [data-value]',
    (elements) => elements.map(el => ({
      text: el.textContent,
      value: el.getAttribute('data-value')
    }))
  );
  
  for (const item of energyValues) {
    const value = item.value || item.text;
    if (value) {
      const numericValue = parseEnergyValue(value);
      if (numericValue > 0) {
        const noonTimestamp = new Date(targetDate.getTime());
        noonTimestamp.setHours(12, 0, 0, 0);
        readings.push({
          siteId: site.id,
          timestamp: noonTimestamp,
          energyWh: numericValue,
          powerW: Math.round(numericValue / 12)
        });
        break;
      }
    }
  }
  
  return readings;
}

async function extractFromChartElements(
  page: Page,
  site: Site,
  targetDate: Date
): Promise<SolarEdgeReading[]> {
  const readings: SolarEdgeReading[] = [];
  
  const chartData = await page.evaluate(() => {
    const win = window as any;
    
    if (win.Highcharts && win.Highcharts.charts) {
      for (const chart of win.Highcharts.charts) {
        if (chart && chart.series) {
          for (const series of chart.series) {
            if (series.data && series.data.length > 0) {
              return series.data.map((point: any) => ({
                x: point.x,
                y: point.y
              }));
            }
          }
        }
      }
    }
    
    if (win.__CHART_DATA__) {
      return win.__CHART_DATA__;
    }
    
    return null;
  });
  
  if (chartData && Array.isArray(chartData)) {
    for (const point of chartData) {
      if (point.x && point.y !== null && point.y !== undefined) {
        readings.push({
          siteId: site.id,
          timestamp: new Date(point.x),
          energyWh: point.y,
          powerW: point.y
        });
      }
    }
  }
  
  return readings;
}

async function extractDailyTotal(page: Page): Promise<number | null> {
  const selectors = [
    '[class*="daily-energy"]',
    '[class*="today"]',
    '[class*="production"] [class*="value"]',
    '.energy-value',
    '[data-type="energy"]'
  ];
  
  for (const selector of selectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        const text = await element.textContent();
        if (text) {
          const value = parseEnergyValue(text);
          if (value > 0) {
            console.log(`[SolarEdge Browser] Found daily total: ${value} Wh`);
            return value;
          }
        }
      }
    } catch (error) {
    }
  }
  
  const allText = await page.textContent('body');
  if (allText) {
    const patterns = [
      /(\d+(?:,\d{3})*(?:\.\d+)?)\s*kWh/gi,
      /(\d+(?:,\d{3})*(?:\.\d+)?)\s*MWh/gi,
      /Production[:\s]*(\d+(?:,\d{3})*(?:\.\d+)?)/gi
    ];
    
    for (const pattern of patterns) {
      const match = pattern.exec(allText);
      if (match) {
        let value = parseFloat(match[1].replace(/,/g, ''));
        if (pattern.source.includes('kWh')) {
          value *= 1000;
        } else if (pattern.source.includes('MWh')) {
          value *= 1000000;
        }
        if (value > 0 && value < 1000000000) {
          console.log(`[SolarEdge Browser] Found energy value from text: ${value} Wh`);
          return value;
        }
      }
    }
  }
  
  return null;
}

function parseEnergyValue(text: string): number {
  const cleanText = text.replace(/[,\s]/g, '').toLowerCase();
  
  const mwhMatch = cleanText.match(/(\d+(?:\.\d+)?)\s*mwh/);
  if (mwhMatch) {
    return parseFloat(mwhMatch[1]) * 1000000;
  }
  
  const kwhMatch = cleanText.match(/(\d+(?:\.\d+)?)\s*kwh/);
  if (kwhMatch) {
    return parseFloat(kwhMatch[1]) * 1000;
  }
  
  const whMatch = cleanText.match(/(\d+(?:\.\d+)?)\s*wh/);
  if (whMatch) {
    return parseFloat(whMatch[1]);
  }
  
  const numMatch = cleanText.match(/(\d+(?:\.\d+)?)/);
  if (numMatch) {
    return parseFloat(numMatch[1]);
  }
  
  return 0;
}

interface SolarEdgeSiteLink extends SolarEdgeDiscoveredSite {
  href: string;
}

export async function discoverSolarEdgeBrowserSites(
  username: string,
  password: string
): Promise<SolarEdgeDiscoveredSite[]> {
  console.log("[SolarEdge Browser] Discovering sites for account...");

  let browser: Browser | null = null;

  try {
    browser = await launchScraperChromium();

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();

    await login(page, username, password);
    await page.waitForTimeout(3000);

    const apiSites = await fetchSolarEdgeBrowserSites(page);
    if (apiSites.length > 0) {
      console.log(`[SolarEdge Browser] Discovered ${apiSites.length} site(s) from the site-list API`);
      return apiSites;
    }

    const visibleSites = await discoverVisibleSolarEdgeSites(page);
    if (visibleSites.length > 0) {
      console.log(`[SolarEdge Browser] Discovered ${visibleSites.length} site(s) from visible site links`);
      return visibleSites.map(({ siteId, siteName }) => ({ siteId, siteName }));
    }

    const currentSite = await readCurrentSolarEdgeSite(page);
    if (currentSite) {
      console.log("[SolarEdge Browser] Account appears to land directly on a single site");
      return [currentSite];
    }

    console.log("[SolarEdge Browser] No site links were visible after login");
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function resolveSolarEdgeBrowserSite(
  page: Page,
  siteIdentifier: string | null
): Promise<SolarEdgeDiscoveredSite> {
  const discoveredSites = await fetchSolarEdgeBrowserSites(page);
  const trimmedIdentifier = siteIdentifier?.trim() || null;

  if (!trimmedIdentifier) {
    if (discoveredSites.length === 1) {
      return discoveredSites[0];
    }

    if (discoveredSites.length > 1) {
      throw new Error("Multiple SolarEdge sites are available for this account. Save the numeric Site ID from Discover Sites before scraping.");
    }

    throw new Error("No SolarEdge sites were available for this account.");
  }

  if (/^\d+$/.test(trimmedIdentifier)) {
    const exactIdMatch = discoveredSites.find((candidate) => candidate.siteId === trimmedIdentifier);
    return exactIdMatch ?? {
      siteId: trimmedIdentifier,
      siteName: `Site ${trimmedIdentifier}`,
    };
  }

  const normalizedIdentifier = normalizeSolarEdgeSiteName(trimmedIdentifier)?.toLowerCase();
  const exactNameMatch = discoveredSites.find((candidate) => (
    normalizeSolarEdgeSiteName(candidate.siteName)?.toLowerCase() === normalizedIdentifier
  ));
  if (exactNameMatch) {
    return exactNameMatch;
  }

  const partialNameMatch = discoveredSites.find((candidate) => (
    candidate.siteName.toLowerCase().includes(trimmedIdentifier.toLowerCase())
  ));
  if (partialNameMatch) {
    return partialNameMatch;
  }

  throw new Error(`Could not find SolarEdge site "${trimmedIdentifier}" in this account.`);
}

async function fetchSolarEdgeBrowserSites(page: Page): Promise<SolarEdgeDiscoveredSite[]> {
  const discoveredSites: SolarEdgeDiscoveredSite[] = [];
  const seenSiteIds = new Set<string>();
  let pageNum = 1;
  let totalSites = Number.POSITIVE_INFINITY;

  while (discoveredSites.length < totalSites) {
    const response = await fetchSolarEdgeBrowserSearchPage(page.context().request, pageNum);
    const sites = response.page ?? [];
    totalSites = response.totalSitesInSearch ?? sites.length;

    if (sites.length === 0) {
      break;
    }

    for (const site of sites) {
      const siteId = site.solarFieldId == null ? null : String(site.solarFieldId).trim();
      if (!siteId || seenSiteIds.has(siteId)) {
        continue;
      }

      seenSiteIds.add(siteId);
      discoveredSites.push({
        siteId,
        siteName: site.name?.trim() || `Site ${siteId}`,
      });
    }

    if (sites.length < SOLAREDGE_BROWSER_SEARCH_PAGE_SIZE) {
      break;
    }

    pageNum += 1;
  }

  return discoveredSites;
}

async function fetchSolarEdgeBrowserSearchPage(
  request: APIRequestContext,
  pageNum: number
): Promise<SolarEdgeSiteSearchResponse> {
  const response = await request.post(
    `${SOLAREDGE_MONITORING_URL}/services/sitelist/searchSites?v=${Date.now()}`,
    {
      data: {
        pageRequest: {
          sitesInPage: SOLAREDGE_BROWSER_SEARCH_PAGE_SIZE,
          pageNum,
          sortRequest: {
            sortColumnType: "maxImpact",
            sortOrder: "DESC",
          },
        },
        locationFilter: {
          countries: [],
          states: [],
          city: "",
          address: "",
          zip: "",
        },
        peakPowerFilter: {
          min: 0,
          max: 1000000,
        },
        maxImpactFilter: {
          min: 0,
          max: 9,
        },
        installationDateFilter: {},
        statusFilter: [],
        serialNumber: "",
        siteNameFilter: "",
        accountNameFilter: [],
        groupFilter: "",
        favoriteFilter: false,
        devicesFilter: {},
        demoSitesFilter: false,
        siteMagnitudeFilter: null,
        geoBoundingBox: null,
      },
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
      },
    }
  );

  if (!response.ok()) {
    const errorText = await response.text();
    throw new Error(`SolarEdge site search failed (${response.status()}): ${errorText.slice(0, 400)}`);
  }

  return response.json();
}

async function extractEnergyDataFromDashboardApis(
  request: APIRequestContext,
  site: Site,
  solarEdgeSiteId: string,
  historyWindow?: HistoryWindow
): Promise<SolarEdgeReading[]> {
  const requestedWindow = historyWindow ?? buildDefaultSolarEdgeBrowserWindow();
  const start = new Date(requestedWindow.start);
  const end = new Date(requestedWindow.end);
  const readingsByTimestamp = new Map<number, SolarEdgeReading>();

  const highResolutionStart = getSolarEdgeHighResolutionStart(start, end);
  const dailyEnd = new Date(highResolutionStart);
  dailyEnd.setDate(dailyEnd.getDate() - 1);
  dailyEnd.setHours(23, 59, 59, 999);

  if (start <= dailyEnd) {
    const dailyReadings = await fetchSolarEdgeDailyDashboardReadings(
      request,
      site.id,
      solarEdgeSiteId,
      start,
      dailyEnd
    );

    for (const reading of dailyReadings) {
      readingsByTimestamp.set(reading.timestamp.getTime(), reading);
    }
  }

  if (highResolutionStart <= end) {
    const powerReadings = await fetchSolarEdgeQuarterHourDashboardReadings(
      request,
      site.id,
      solarEdgeSiteId,
      highResolutionStart,
      end
    );

    for (const reading of powerReadings) {
      readingsByTimestamp.set(reading.timestamp.getTime(), reading);
    }
  }

  if (readingsByTimestamp.size === 0) {
    console.log("[SolarEdge Browser] Dashboard APIs returned no readings in the requested window.");
  }

  return Array.from(readingsByTimestamp.values()).sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime()
  );
}

async function fetchSolarEdgeDailyDashboardReadings(
  request: APIRequestContext,
  dbSiteId: number,
  solarEdgeSiteId: string,
  start: Date,
  end: Date
): Promise<SolarEdgeReading[]> {
  const readings: SolarEdgeReading[] = [];

  for (const chunk of chunkDateRange(start, end, SOLAREDGE_BROWSER_DAILY_CHUNK_DAYS)) {
    const response = await request.get(
      `${SOLAREDGE_MONITORING_URL}/services/dashboard/energy/sites/${solarEdgeSiteId}` +
      `?start-date=${formatDate(chunk.start)}` +
      `&end-date=${formatDate(chunk.end)}` +
      `&chart-time-unit=days&measurement-types=production,yield`
    );

    if (!response.ok()) {
      const errorText = await response.text();
      throw new Error(`SolarEdge dashboard daily energy failed (${response.status()}): ${errorText.slice(0, 400)}`);
    }

    const data: SolarEdgeDashboardEnergyResponse = await response.json();
    for (const measurement of data.chart?.measurements ?? []) {
      if (!measurement.measurementTime || measurement.production == null) {
        continue;
      }

      const timestamp = new Date(measurement.measurementTime);
      timestamp.setHours(12, 0, 0, 0);

      readings.push({
        siteId: dbSiteId,
        timestamp,
        energyWh: measurement.production,
        powerW: Math.round(measurement.production / 12),
      });
    }
  }

  return readings;
}

async function fetchSolarEdgeQuarterHourDashboardReadings(
  request: APIRequestContext,
  dbSiteId: number,
  solarEdgeSiteId: string,
  start: Date,
  end: Date
): Promise<SolarEdgeReading[]> {
  const readings: SolarEdgeReading[] = [];

  for (const chunk of chunkDateRange(start, end, SOLAREDGE_BROWSER_HIGH_RES_CHUNK_DAYS)) {
    const response = await request.get(
      `${SOLAREDGE_MONITORING_URL}/services/dashboard/power/sites/${solarEdgeSiteId}` +
      `?start-date=${formatDate(chunk.start)}` +
      `&end-date=${formatDate(chunk.end)}` +
      `&chart-time-unit=quarter-hours&measurement-types=production,storage-charge-level`
    );

    if (!response.ok()) {
      const errorText = await response.text();
      throw new Error(`SolarEdge dashboard power failed (${response.status()}): ${errorText.slice(0, 400)}`);
    }

    const data: SolarEdgeDashboardPowerResponse = await response.json();
    for (const measurement of data.measurements ?? []) {
      if (!measurement.measurementTime || measurement.production == null) {
        continue;
      }

      const timestamp = new Date(measurement.measurementTime);
      const powerW = measurement.production;

      readings.push({
        siteId: dbSiteId,
        timestamp,
        energyWh: Math.round(powerW / 4),
        powerW,
      });
    }
  }

  return readings;
}

function buildDefaultSolarEdgeBrowserWindow(): HistoryWindow {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 1);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function getSolarEdgeHighResolutionStart(start: Date, end: Date): Date {
  const candidate = new Date(end);
  candidate.setDate(candidate.getDate() - (SOLAREDGE_BROWSER_HIGH_RES_DAYS - 1));
  candidate.setHours(0, 0, 0, 0);
  return candidate > start ? candidate : new Date(start);
}

async function discoverVisibleSolarEdgeSites(page: Page): Promise<SolarEdgeSiteLink[]> {
  const links = await page.$$eval("a[href*='/site/'], a[href*='siteId=']", (elements) =>
    elements.map((element) => ({
      href: (element as HTMLAnchorElement).href,
      text: element.textContent?.trim() || "",
    }))
  );

  const discoveredSites: SolarEdgeSiteLink[] = [];
  const seenSiteIds = new Set<string>();

  for (const link of links) {
    const siteId = extractSolarEdgeSiteId(link.href);
    if (!siteId || seenSiteIds.has(siteId)) {
      continue;
    }

    seenSiteIds.add(siteId);
    discoveredSites.push({
      siteId,
      siteName: normalizeSolarEdgeSiteName(link.text) ?? `Site ${siteId}`,
      href: link.href,
    });
  }

  return discoveredSites;
}

async function navigateToDiscoveredSite(page: Page, site: SolarEdgeSiteLink): Promise<string> {
  console.log(`[SolarEdge Browser] Opening discovered site ${site.siteId} (${site.siteName})`);
  await page.goto(site.href, { waitUntil: "networkidle", timeout: 20000 });
  return page.url();
}

async function readCurrentSolarEdgeSite(page: Page): Promise<SolarEdgeDiscoveredSite | null> {
  const siteId = extractSolarEdgeSiteId(page.url());
  if (!siteId) {
    return null;
  }

  const pageSiteName = await page.evaluate(() => {
    const selectors = [
      "h1",
      "[data-testid*='site']",
      "[class*='site-name']",
      "[class*='siteName']",
      ".siteName",
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const text = element?.textContent?.replace(/\s+/g, " ").trim();
      if (text) {
        return text;
      }
    }

    const title = document.title.replace(/\s+/g, " ").trim();
    return title || null;
  });

  return {
    siteId,
    siteName: normalizeSolarEdgeSiteName(pageSiteName) ?? `Site ${siteId}`,
  };
}

function extractSolarEdgeSiteId(url: string): string | null {
  const directMatch = url.match(/\/site\/(\d+)/i);
  if (directMatch) {
    return directMatch[1];
  }

  const queryMatch = url.match(/[?&]siteId=(\d+)/i);
  if (queryMatch) {
    return queryMatch[1];
  }

  return null;
}

function isSolarEdgeSiteUrl(url: string): boolean {
  return extractSolarEdgeSiteId(url) !== null;
}

function normalizeSolarEdgeSiteName(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function chunkDateRange(start: Date, end: Date, chunkDays: number): Array<{ start: Date; end: Date }> {
  const chunks: Array<{ start: Date; end: Date }> = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);

  const endBoundary = new Date(end);
  endBoundary.setHours(0, 0, 0, 0);

  while (cursor <= endBoundary) {
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + chunkDays - 1);
    if (chunkEnd > endBoundary) {
      chunkEnd.setTime(endBoundary.getTime());
    }

    chunks.push({ start: chunkStart, end: chunkEnd });

    cursor.setTime(chunkEnd.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }

  return chunks;
}
