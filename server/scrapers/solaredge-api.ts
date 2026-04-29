import type { Site } from "@shared/schema";
import type { HistoryWindow } from "../history";

interface SolarEdgeReading {
  siteId: number;
  timestamp: Date;
  energyWh: number;
  powerW: number;
}

interface SolarEdgeEnergyResponse {
  energy: {
    timeUnit: string;
    unit: string;
    measuredBy: string;
    values: Array<{
      date: string;
      value: number | null;
    }>;
  };
}

interface SolarEdgePowerResponse {
  power: {
    timeUnit: string;
    unit: string;
    measuredBy: string;
    values: Array<{
      date: string;
      value: number | null;
    }>;
  };
}

export interface SolarEdgeDiscoveredSite {
  siteId: string;
  siteName: string;
}

interface SolarEdgeSitesListResponse {
  sites?: {
    list?: Array<{
      id?: number | string | null;
      name?: string | null;
      siteName?: string | null;
    }>;
  };
}

interface SolarEdgeApiErrorResponse {
  title?: string | null;
  detail?: string | null;
  error?: string | null;
  message?: string | null;
}

const SOLAREDGE_API_BASE = "https://monitoringapi.solaredge.com";
const SOLAREDGE_CHUNK_DAYS = 30;

export async function scrapeSolarEdgeAPI(
  site: Site,
  apiKey: string,
  solarEdgeSiteId: string,
  historyWindow?: HistoryWindow
): Promise<SolarEdgeReading[]> {
  console.log(`[SolarEdge API] Starting scrape for ${site.name}`);
  console.log(`[SolarEdge API] Site ID: ${solarEdgeSiteId}`);

  const defaultEnd = new Date();
  defaultEnd.setHours(0, 0, 0, 0);
  const defaultStart = new Date(defaultEnd);
  defaultStart.setDate(defaultStart.getDate() - 1);

  const start = historyWindow?.start ?? defaultStart;
  const end = historyWindow?.end ?? defaultEnd;
  const readingsByTimestamp = new Map<number, SolarEdgeReading>();

  for (const chunk of chunkDateRange(start, end, SOLAREDGE_CHUNK_DAYS)) {
    const startDate = formatDate(chunk.start);
    const endDate = formatDate(chunk.end);
    const energyData = await fetchEnergyData(solarEdgeSiteId, apiKey, startDate, endDate);

    let addedHourly = 0;
    if (energyData.energy?.values) {
      for (const value of energyData.energy.values) {
        if (value.date && value.value !== null) {
          const timestamp = parseDateTime(value.date);
          readingsByTimestamp.set(timestamp.getTime(), {
            siteId: site.id,
            timestamp,
            energyWh: value.value,
            powerW: value.value,
          });
          addedHourly += 1;
        }
      }
    }

    if (addedHourly > 0) {
      continue;
    }

    console.log(`[SolarEdge API] No hourly data for ${startDate} to ${endDate}, fetching daily energy...`);
    const dailyEnergy = await fetchDailyEnergy(solarEdgeSiteId, apiKey, startDate, endDate);

    if (dailyEnergy.energy?.values) {
      for (const value of dailyEnergy.energy.values) {
        if (value.date && value.value !== null) {
          const timestamp = new Date(value.date);
          timestamp.setHours(12, 0, 0, 0);

          readingsByTimestamp.set(timestamp.getTime(), {
            siteId: site.id,
            timestamp,
            energyWh: value.value,
            powerW: Math.round(value.value / 12),
          });
        }
      }
    }
  }

  const readings = Array.from(readingsByTimestamp.values()).sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime()
  );

  console.log(`[SolarEdge API] Retrieved ${readings.length} readings for ${site.name}`);
  return readings;
}

async function fetchEnergyData(
  solarEdgeSiteId: string,
  apiKey: string,
  startDate: string,
  endDate: string
): Promise<SolarEdgeEnergyResponse> {
  const url = `${SOLAREDGE_API_BASE}/site/${solarEdgeSiteId}/energy?` +
    `timeUnit=HOUR&startDate=${startDate}&endDate=${endDate}&api_key=${apiKey}`;
  
  console.log(`[SolarEdge API] Fetching hourly energy data...`);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(await buildSolarEdgeApiErrorMessage(response));
  }
  
  return response.json();
}

async function fetchDailyEnergy(
  solarEdgeSiteId: string,
  apiKey: string,
  startDate: string,
  endDate: string
): Promise<SolarEdgeEnergyResponse> {
  const url = `${SOLAREDGE_API_BASE}/site/${solarEdgeSiteId}/energy?` +
    `timeUnit=DAY&startDate=${startDate}&endDate=${endDate}&api_key=${apiKey}`;
  
  console.log(`[SolarEdge API] Fetching daily energy data...`);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(await buildSolarEdgeApiErrorMessage(response));
  }
  
  return response.json();
}

async function buildSolarEdgeApiErrorMessage(response: Response): Promise<string> {
  const rawBody = (await response.text()).trim();
  let detail = rawBody;

  if (rawBody) {
    try {
      const parsed = JSON.parse(rawBody) as SolarEdgeApiErrorResponse;
      detail =
        parsed.detail?.trim() ||
        parsed.message?.trim() ||
        parsed.error?.trim() ||
        parsed.title?.trim() ||
        rawBody;
    } catch (_error) {
      detail = rawBody;
    }
  } else {
    detail = response.statusText || "Unknown SolarEdge API error";
  }

  return `SolarEdge API error ${response.status}: ${detail}`;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateTime(dateStr: string): Date {
  if (dateStr.includes(" ")) {
    const [datePart, timePart] = dateStr.split(" ");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute, second] = timePart.split(":").map(Number);
    return new Date(year, month - 1, day, hour, minute, second || 0);
  }
  
  return new Date(dateStr);
}

function chunkDateRange(start: Date, end: Date, chunkDays: number): Array<{ start: Date; end: Date }> {
  const chunks: Array<{ start: Date; end: Date }> = [];
  let cursor = new Date(start);
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

    cursor = new Date(chunkEnd);
    cursor.setDate(cursor.getDate() + 1);
  }

  return chunks;
}

export async function discoverSolarEdgeApiSites(apiKey: string): Promise<SolarEdgeDiscoveredSite[]> {
  const url = `${SOLAREDGE_API_BASE}/sites/list?size=100&api_key=${apiKey}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(await buildSolarEdgeApiErrorMessage(response));
  }

  const data: SolarEdgeSitesListResponse = await response.json();
  const items = data.sites?.list ?? [];

  return items.flatMap((site) => {
    const siteId = site.id == null ? null : String(site.id).trim();
    if (!siteId) {
      return [];
    }

    const siteName = site.name?.trim() || site.siteName?.trim() || `Site ${siteId}`;
    return [{ siteId, siteName }];
  });
}

export async function verifySolarEdgeApiKey(
  apiKey: string
): Promise<{ valid: boolean; sites?: SolarEdgeDiscoveredSite[] }> {
  try {
    const sites = await discoverSolarEdgeApiSites(apiKey);
    return {
      valid: true,
      sites,
    };
  } catch (_error) {
    return { valid: false };
  }
}
