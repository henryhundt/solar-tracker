import type { Site } from "@shared/schema";
import type { HistoryWindow } from "../history";
import type { APIRequestContext, Browser, Page } from "playwright";
import { launchScraperChromium } from "./playwright";
import { loginSolarEdge } from "./solaredge-login";
import type { SolarEdgeDiscoveredSite } from "./solaredge-api";

interface SolarEdgeReading {
  siteId: number;
  timestamp: Date;
  energyWh: number;
  powerW: number | null;
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
const SOLAREDGE_BROWSER_DAILY_CHUNK_DAYS = 31;
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
    
    await loginSolarEdge(page, username, password);

    const browserSite = await resolveSolarEdgeBrowserSite(page, site.siteIdentifier || site.name);
    console.log(`[SolarEdge Browser] Resolved site ${browserSite.siteId} (${browserSite.siteName})`);

    // Only timestamped provider measurements are valid readings. Never infer
    // daily production from unrelated numbers in rendered dashboard text.
    const readings = await extractEnergyDataFromDashboardApis(
      page.context().request, site, browserSite.siteId, historyWindow,
    );

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

    await loginSolarEdge(page, username, password);
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

export async function extractEnergyDataFromDashboardApis(
  request: APIRequestContext,
  site: Site,
  solarEdgeSiteId: string,
  historyWindow?: HistoryWindow
): Promise<SolarEdgeReading[]> {
  const requestedWindow = historyWindow ?? buildDefaultSolarEdgeBrowserWindow();
  // Provider query dates are site-local calendar days, independent of server TZ.
  const start = siteCalendarDate(requestedWindow.start, site.timezone);
  const end = siteCalendarDate(requestedWindow.end, site.timezone);
  const readingsByTimestamp = new Map<number, SolarEdgeReading>();

  const highResolutionStart = getSolarEdgeHighResolutionStart(start, end);
  const dailyEnd = new Date(highResolutionStart);
  dailyEnd.setUTCDate(dailyEnd.getUTCDate() - 1);
  dailyEnd.setUTCHours(23, 59, 59, 999);

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

  const inWindow = filterReadingsToWindow(Array.from(readingsByTimestamp.values()), requestedWindow);
  if (inWindow.length === 0) {
    throw new Error("SolarEdge dashboard returned no production measurements in the requested window; readings were not updated.");
  }

  return inWindow.sort(
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
      `&chart-time-unit=days&measurement-types=production&measurement-types=yield&isCniViewer=true`
    );

    if (!response.ok()) {
      throw new Error(`SolarEdge dashboard daily energy failed (HTTP ${response.status()}).`);
    }

    const data: SolarEdgeDashboardEnergyResponse = await response.json();
    validateMeasurements(data.chart?.measurements);
    for (const measurement of data.chart!.measurements!) {
      if (!measurement.measurementTime || measurement.production == null) {
        continue;
      }

      const timestamp = new Date(measurement.measurementTime);

      readings.push({
        siteId: dbSiteId,
        timestamp,
        energyWh: measurement.production,
        powerW: null,
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
      `&chart-time-unit=quarter-hours&measurement-types=production&measurement-types=storage-charge-level`
    );

    if (!response.ok()) {
      throw new Error(`SolarEdge dashboard power failed (HTTP ${response.status()}).`);
    }

    const data: SolarEdgeDashboardPowerResponse = await response.json();
    validateMeasurements(data.measurements);
    for (const measurement of data.measurements!) {
      if (!measurement.measurementTime || measurement.production == null) {
        continue;
      }

      const timestamp = new Date(measurement.measurementTime);
      const powerW = measurement.production;

      readings.push({
        siteId: dbSiteId,
        timestamp,
        energyWh: powerW / 4,
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
  candidate.setUTCDate(candidate.getUTCDate() - (SOLAREDGE_BROWSER_HIGH_RES_DAYS - 1));
  candidate.setUTCHours(0, 0, 0, 0);
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
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function chunkDateRange(start: Date, end: Date, chunkDays: number): Array<{ start: Date; end: Date }> {
  const chunks: Array<{ start: Date; end: Date }> = [];
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);

  const endBoundary = new Date(end);
  endBoundary.setUTCHours(0, 0, 0, 0);

  while (cursor <= endBoundary) {
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + chunkDays - 1);
    if (chunkEnd > endBoundary) {
      chunkEnd.setTime(endBoundary.getTime());
    }

    chunks.push({ start: chunkStart, end: chunkEnd });

    cursor.setTime(chunkEnd.getTime());
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return chunks;
}

function validateMeasurements(value: unknown): void {
  if (!Array.isArray(value) || value.some(item =>
    !item || typeof item !== "object"
    || typeof item.measurementTime !== "string"
    || !/(?:Z|[+-]\d{2}:\d{2})$/.test(item.measurementTime)
    || !Number.isFinite(Date.parse(item.measurementTime))
    || (item.production != null && (typeof item.production !== "number" || !Number.isFinite(item.production) || item.production < 0))
  )) {
    throw new Error("SolarEdge dashboard returned invalid timestamped production measurements.");
  }
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

function siteCalendarDate(value: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone, year:"numeric", month:"2-digit", day:"2-digit"}).formatToParts(value);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
}
