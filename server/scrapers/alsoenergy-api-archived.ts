// ARCHIVED: Also Energy REST API scraper
// Requires API access enabled on the Also Energy account (contact Also Energy support).
// The account in use does not have API access, so browser automation is used instead.
// See alsoenergy-browser.ts for the active implementation.

import type { Site } from "@shared/schema";

interface AlsoEnergyReading {
  siteId: number;
  timestamp: Date;
  energyWh: number;
  powerW: number;
}

interface AlsoEnergyAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

interface AlsoEnergySiteNode {
  siteId: number;
  siteName: string;
  alertCount?: number | null;
}

interface AlsoEnergyHardwareItem {
  id: number;
  name: string;
  stringId?: string;
  functionCode?: string;
  fieldsArchived?: string[];
  flags?: string[];
}

interface AlsoEnergyChartInfo {
  id: number;
  name: string;
  description?: string;
}

const ALSOENERGY_API_BASE = "https://api.alsoenergy.com";

export async function authenticateAlsoEnergy(
  username: string,
  password: string,
  baseUrl?: string
): Promise<{ accessToken: string; baseUrl: string }> {
  const apiBase = baseUrl || ALSOENERGY_API_BASE;
  console.log(`[AlsoEnergy] Authenticating at ${apiBase}...`);

  const body = new URLSearchParams();
  body.append("grant_type", "password");
  body.append("username", username);
  body.append("password", password);

  const response = await fetch(`${apiBase}/Auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AlsoEnergy auth failed (${response.status}): ${errorText}`);
  }

  const data: AlsoEnergyAuthResponse = await response.json();
  console.log(`[AlsoEnergy] Authenticated successfully`);
  return { accessToken: data.access_token, baseUrl: apiBase };
}

export async function discoverAlsoEnergySites(
  username: string,
  password: string,
  baseUrl?: string
): Promise<Array<{ siteId: number; siteName: string }>> {
  const { accessToken, baseUrl: apiBase } = await authenticateAlsoEnergy(username, password, baseUrl);

  console.log(`[AlsoEnergy] Fetching site list...`);
  const response = await fetch(`${apiBase}/Sites`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AlsoEnergy sites list failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  const sites: Array<{ siteId: number; siteName: string }> = [];
  const items = data.items || data;
  if (Array.isArray(items)) {
    for (const item of items) {
      sites.push({
        siteId: item.siteId,
        siteName: item.siteName || item.name || `Site ${item.siteId}`,
      });
    }
  }

  console.log(`[AlsoEnergy] Found ${sites.length} sites`);
  return sites;
}

export async function scrapeAlsoEnergy(
  site: Site,
  apiUrl: string,
  username: string,
  password: string,
  _apiKey?: string | null
): Promise<AlsoEnergyReading[]> {
  console.log(`[AlsoEnergy] Starting scrape for ${site.name}`);

  const { accessToken, baseUrl } = await authenticateAlsoEnergy(username, password, apiUrl || undefined);

  const alsoSiteId = site.siteIdentifier;
  if (!alsoSiteId) {
    throw new Error(
      "Also Energy site ID is required. Use the 'Discover Sites' button to find your site IDs, then enter one in the Site Identifier field."
    );
  }

  const parsedSiteId = parseInt(alsoSiteId, 10);
  if (isNaN(parsedSiteId)) {
    throw new Error(`Also Energy site ID must be a number, got: "${alsoSiteId}"`);
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const endOfYesterday = new Date(yesterday.getTime());
  endOfYesterday.setHours(23, 59, 59, 999);

  let readings = await fetchViaCharts(baseUrl, accessToken, site.id, parsedSiteId, yesterday, endOfYesterday);

  if (readings.length === 0) {
    console.log(`[AlsoEnergy] Charts approach returned no data, trying BinData...`);
    readings = await fetchViaBinData(baseUrl, accessToken, site.id, parsedSiteId, yesterday, endOfYesterday);
  }

  if (readings.length === 0) {
    console.log(`[AlsoEnergy] BinData returned no data, trying site summary...`);
    readings = await fetchViaSiteSummary(baseUrl, accessToken, site.id, parsedSiteId, yesterday);
  }

  console.log(`[AlsoEnergy] Retrieved ${readings.length} readings for ${site.name}`);
  return readings;
}

async function fetchViaCharts(
  baseUrl: string,
  accessToken: string,
  dbSiteId: number,
  alsoSiteId: number,
  startDate: Date,
  endDate: Date
): Promise<AlsoEnergyReading[]> {
  const readings: AlsoEnergyReading[] = [];

  try {
    const chartsResponse = await fetch(`${baseUrl}/Sites/${alsoSiteId}/Charts`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!chartsResponse.ok) {
      console.log(`[AlsoEnergy] Charts list failed (${chartsResponse.status})`);
      return readings;
    }

    const chartsData = await chartsResponse.json();
    const charts: AlsoEnergyChartInfo[] = chartsData.items || chartsData || [];

    const energyChart = charts.find(
      (c) =>
        c.name?.toLowerCase().includes("energy") ||
        c.name?.toLowerCase().includes("production") ||
        c.name?.toLowerCase().includes("generation") ||
        c.name?.toLowerCase().includes("kwh")
    );

    if (!energyChart) {
      console.log(`[AlsoEnergy] No energy chart found among ${charts.length} charts: ${charts.map(c => c.name).join(', ')}`);
      return readings;
    }

    console.log(`[AlsoEnergy] Using chart: "${energyChart.name}" (ID: ${energyChart.id})`);

    const fromStr = formatLocalTime(startDate);
    const toStr = formatLocalTime(endDate);

    const chartDataUrl =
      `${baseUrl}/Charts/${energyChart.id}/Data?` +
      `fromLocalTime=${encodeURIComponent(fromStr)}&` +
      `toLocalTime=${encodeURIComponent(toStr)}&` +
      `siteId=${alsoSiteId}&` +
      `binSize=Bin1Hour`;

    const dataResponse = await fetch(chartDataUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!dataResponse.ok) {
      const errText = await dataResponse.text();
      console.log(`[AlsoEnergy] Chart data fetch failed (${dataResponse.status}): ${errText}`);
      return readings;
    }

    const chartResult = await dataResponse.json();
    parseChartResult(chartResult, dbSiteId, readings);
  } catch (error: any) {
    console.log(`[AlsoEnergy] Charts approach error: ${error.message}`);
  }

  return readings;
}

async function fetchViaBinData(
  baseUrl: string,
  accessToken: string,
  dbSiteId: number,
  alsoSiteId: number,
  startDate: Date,
  endDate: Date
): Promise<AlsoEnergyReading[]> {
  const readings: AlsoEnergyReading[] = [];

  try {
    const hardwareResponse = await fetch(`${baseUrl}/Sites/${alsoSiteId}/Hardware`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!hardwareResponse.ok) {
      console.log(`[AlsoEnergy] Hardware list failed (${hardwareResponse.status})`);
      return readings;
    }

    const hardwareData = await hardwareResponse.json();
    const hardwareList: AlsoEnergyHardwareItem[] = hardwareData.hardware || hardwareData || [];

    const meters = hardwareList.filter(
      (hw) => hw.functionCode === "PM" || hw.functionCode === "SM"
    );
    const inverters = hardwareList.filter((hw) => hw.functionCode === "PV");
    const targetHardware = meters.length > 0 ? meters : inverters;

    if (targetHardware.length === 0) {
      console.log(
        `[AlsoEnergy] No meters or inverters found. Hardware types: ${hardwareList.map((h) => `${h.name}(${h.functionCode})`).join(", ")}`
      );
      if (hardwareList.length > 0) {
        targetHardware.push(hardwareList[0]);
      } else {
        return readings;
      }
    }

    console.log(
      `[AlsoEnergy] Using hardware: ${targetHardware.map((h) => `${h.name} (${h.functionCode}, ID:${h.id})`).join(", ")}`
    );

    const fromStr = formatLocalTime(startDate);
    const toStr = formatLocalTime(endDate);

    const fields = targetHardware.map((hw) => ({
      hardwareId: hw.id,
      fieldName: "KWhDel",
    }));

    const binDataUrl =
      `${baseUrl}/Data/BinData?` +
      `fromLocalTime=${encodeURIComponent(fromStr)}&` +
      `toLocalTime=${encodeURIComponent(toStr)}&` +
      `binSizes=Bin1Hour`;

    const dataResponse = await fetch(binDataUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fields),
    });

    if (!dataResponse.ok) {
      const errText = await dataResponse.text();
      console.log(`[AlsoEnergy] BinData failed (${dataResponse.status}): ${errText}`);

      const altFields = targetHardware.map((hw) => ({
        hardwareId: hw.id,
        fieldName: "WRcv",
      }));

      const altResponse = await fetch(binDataUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(altFields),
      });

      if (altResponse.ok) {
        const altResult = await altResponse.json();
        parseBinDataResult(altResult, dbSiteId, readings, true);
      }

      return readings;
    }

    const binResult = await dataResponse.json();
    parseBinDataResult(binResult, dbSiteId, readings, false);
  } catch (error: any) {
    console.log(`[AlsoEnergy] BinData approach error: ${error.message}`);
  }

  return readings;
}

async function fetchViaSiteSummary(
  baseUrl: string,
  accessToken: string,
  dbSiteId: number,
  alsoSiteId: number,
  targetDate: Date
): Promise<AlsoEnergyReading[]> {
  const readings: AlsoEnergyReading[] = [];

  try {
    const siteResponse = await fetch(`${baseUrl}/Sites/${alsoSiteId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!siteResponse.ok) {
      console.log(`[AlsoEnergy] Site detail failed (${siteResponse.status})`);
      return readings;
    }

    const siteData = await siteResponse.json();
    console.log(`[AlsoEnergy] Site detail keys: ${Object.keys(siteData).join(", ")}`);

    const production = siteData.productionData;
    if (production) {
      const yesterdayKwh = production.yesterdayKwh || 0;
      const todayKwh = production.todayKwh || 0;
      const nowKw = production.nowKw || 0;

      console.log(
        `[AlsoEnergy] Production summary - Yesterday: ${yesterdayKwh} kWh, Today: ${todayKwh} kWh, Now: ${nowKw} kW`
      );

      if (yesterdayKwh > 0) {
        const noonTimestamp = new Date(targetDate.getTime());
        noonTimestamp.setHours(12, 0, 0, 0);
        readings.push({
          siteId: dbSiteId,
          timestamp: noonTimestamp,
          energyWh: Math.round(yesterdayKwh * 1000),
          powerW: Math.round((yesterdayKwh * 1000) / 12),
        });
      }
    }
  } catch (error: any) {
    console.log(`[AlsoEnergy] Site summary error: ${error.message}`);
  }

  return readings;
}

function parseChartResult(chartResult: any, dbSiteId: number, readings: AlsoEnergyReading[]) {
  if (chartResult.series && Array.isArray(chartResult.series)) {
    for (const series of chartResult.series) {
      const dataPoints = series.data || series.values || [];
      for (const point of dataPoints) {
        const ts = point.timestamp || point.time || point[0];
        const val = point.value || point.y || point[1];
        if (ts && val !== null && val !== undefined) {
          readings.push({
            siteId: dbSiteId,
            timestamp: new Date(ts),
            energyWh: Math.round(typeof val === "number" ? val * 1000 : parseFloat(val) * 1000),
            powerW: 0,
          });
        }
      }
    }
  } else if (chartResult.data && Array.isArray(chartResult.data)) {
    for (const point of chartResult.data) {
      const ts = point.timestamp || point.time;
      const val = point.value || point.energy || point.kWh;
      if (ts && val !== null && val !== undefined) {
        readings.push({
          siteId: dbSiteId,
          timestamp: new Date(ts),
          energyWh: Math.round(typeof val === "number" ? val * 1000 : parseFloat(val) * 1000),
          powerW: 0,
        });
      }
    }
  } else if (Array.isArray(chartResult)) {
    for (const point of chartResult) {
      const ts = point.timestamp || point.time;
      const val = point.value || point.energy;
      if (ts && val !== null && val !== undefined) {
        readings.push({
          siteId: dbSiteId,
          timestamp: new Date(ts),
          energyWh: Math.round(typeof val === "number" ? val * 1000 : parseFloat(val) * 1000),
          powerW: 0,
        });
      }
    }
  }

  console.log(`[AlsoEnergy] Parsed ${readings.length} readings from chart data`);
}

function parseBinDataResult(
  binResult: any,
  dbSiteId: number,
  readings: AlsoEnergyReading[],
  isPower: boolean
) {
  const items = Array.isArray(binResult) ? binResult : binResult.data || binResult.items || [];

  for (const item of items) {
    const ts = item.timestamp || item.time || item.localTime;
    let val = item.value || item.data || item.avg || 0;

    if (ts) {
      if (isPower) {
        readings.push({
          siteId: dbSiteId,
          timestamp: new Date(ts),
          energyWh: Math.round(val),
          powerW: Math.round(val),
        });
      } else {
        readings.push({
          siteId: dbSiteId,
          timestamp: new Date(ts),
          energyWh: Math.round(val * 1000),
          powerW: 0,
        });
      }
    }
  }

  console.log(`[AlsoEnergy] Parsed ${readings.length} readings from BinData`);
}

function formatLocalTime(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}:${s}`;
}
