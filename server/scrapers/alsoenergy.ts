import { getAlsoEnergyApiSiteId } from "@shared/alsoenergy";
import type { Site } from "@shared/schema";
import type { HistoryWindow } from "../history";

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

interface AlsoEnergySiteDetail {
  siteId?: number;
  name?: string;
  timeZone?: {
    name?: string | null;
  } | null;
  productionData?: {
    yesterdayKwh?: number | null;
    todayKwh?: number | null;
    nowKw?: number | null;
  } | null;
}

interface AlsoEnergyHardwareItem {
  id: number;
  name: string;
  stringId?: string;
  functionCode?: string;
  fieldsArchived?: string[];
  flags?: string[];
}

interface AlsoEnergyHardwareListResult {
  hardware?: AlsoEnergyHardwareItem[];
  summaryFields?: string[];
}

interface BinDataFieldRequest {
  siteId?: number;
  hardwareId?: number;
  fieldName: string;
  function: "Avg" | "Last" | "Diff" | "DiffNonZero";
}

interface AlsoEnergyDataBinInfo {
  hardwareId?: number | null;
  siteId?: number | null;
  dataIndex: number;
  name?: string | null;
  units?: string | null;
}

interface AlsoEnergyDataBinItem {
  timestamp?: string;
  data?: Array<number | null>;
}

interface AlsoEnergyDataBinResults {
  info?: AlsoEnergyDataBinInfo[];
  items?: AlsoEnergyDataBinItem[];
  message?: string | null;
}

type BinPlanInterpretation = "energy_delta" | "energy_cumulative" | "power_average";

interface AlsoEnergyBinPlan {
  label: string;
  fields: BinDataFieldRequest[];
  interpretation: BinPlanInterpretation;
}

const ALSOENERGY_API_BASE = "https://api.alsoenergy.com";
const ALSOENERGY_CHUNK_DAYS = 120;
const DEFAULT_SITE_TIMEZONE = "UTC";
const ENERGY_SUMMARY_FIELD_CANDIDATES = ["ProdKWH", "NetKWH"];
const ENERGY_HARDWARE_FIELD_CANDIDATES = ["ProdKWH", "KWhDel", "kWhDel", "TotKWH"];
const POWER_HARDWARE_FIELD_CANDIDATES = ["WRcv", "W", "KW"];

export async function authenticateAlsoEnergy(
  username: string,
  password: string,
  baseUrl?: string
): Promise<{ accessToken: string; baseUrl: string }> {
  const apiBase = resolveAlsoEnergyApiBase(baseUrl);
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
  _apiKey?: string | null,
  historyWindow?: HistoryWindow
): Promise<AlsoEnergyReading[]> {
  console.log(`[AlsoEnergy] Starting API scrape for ${site.name}`);

  const apiSiteId = getAlsoEnergyApiSiteId(site);
  if (!apiSiteId) {
    throw new Error("Also Energy API scraping requires a numeric API Site ID.");
  }

  const parsedSiteId = Number.parseInt(apiSiteId, 10);
  if (Number.isNaN(parsedSiteId)) {
    throw new Error(`Also Energy API site ID must be numeric, got: "${apiSiteId}"`);
  }

  const { accessToken, baseUrl } = await authenticateAlsoEnergy(username, password, apiUrl || undefined);
  const requestedWindow = historyWindow ?? buildDefaultAlsoEnergyWindow();

  const [siteDetail, hardwareSnapshot] = await Promise.all([
    fetchSiteDetail(baseUrl, accessToken, parsedSiteId),
    fetchHardwareSnapshot(baseUrl, accessToken, parsedSiteId),
  ]);

  const siteTimeZone = siteDetail.timeZone?.name || DEFAULT_SITE_TIMEZONE;
  const normalizedWindow = normalizeHistoryWindowForBinData(requestedWindow, siteTimeZone);
  if (normalizedWindow === null) {
    console.log("[AlsoEnergy] Requested window does not include a completed hourly bin yet.");
    return [];
  }

  const plans = buildBinDataPlans(parsedSiteId, hardwareSnapshot);
  const readingsByTimestamp = new Map<number, AlsoEnergyReading>();

  for (const chunk of chunkDateRange(normalizedWindow.start, normalizedWindow.end, ALSOENERGY_CHUNK_DAYS)) {
    console.log(
      `[AlsoEnergy] Fetching chunk ${formatDate(chunk.start)} to ${formatDate(chunk.end)} (${siteTimeZone}) for ${site.name}`
    );

    const chunkReadings = await fetchHourlyChunk(
      baseUrl,
      accessToken,
      site.id,
      parsedSiteId,
      siteTimeZone,
      chunk.start,
      chunk.end,
      plans
    );

    for (const reading of chunkReadings) {
      readingsByTimestamp.set(reading.timestamp.getTime(), reading);
    }
  }

  if (readingsByTimestamp.size === 0) {
    console.log("[AlsoEnergy] No hourly API rows returned, falling back to site production summary.");
    const summaryReadings = buildSummaryFallbackReadings(site.id, siteDetail, siteTimeZone);
    for (const reading of summaryReadings) {
      if (
        reading.timestamp >= requestedWindow.start &&
        reading.timestamp <= requestedWindow.end
      ) {
        readingsByTimestamp.set(reading.timestamp.getTime(), reading);
      }
    }
  }

  const readings = Array.from(readingsByTimestamp.values()).sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime()
  );

  console.log(`[AlsoEnergy] Retrieved ${readings.length} reading(s) for ${site.name}`);
  return readings;
}

async function fetchHourlyChunk(
  baseUrl: string,
  accessToken: string,
  dbSiteId: number,
  alsoSiteId: number,
  siteTimeZone: string,
  startDate: Date,
  endDate: Date,
  plans: AlsoEnergyBinPlan[]
): Promise<AlsoEnergyReading[]> {
  for (const plan of plans) {
    const result = await fetchBinData(
      baseUrl,
      accessToken,
      startDate,
      endDate,
      siteTimeZone,
      plan.fields
    );

    if (result.items && result.items.length === 0 && result.message) {
      console.log(`[AlsoEnergy] BinData plan "${plan.label}" returned no rows: ${result.message}`);
    }

    const readings = parseBinDataResult(result, dbSiteId, plan.interpretation, siteTimeZone);
    if (readings.length > 0) {
      console.log(
        `[AlsoEnergy] BinData plan "${plan.label}" succeeded with ${readings.length} row(s) for site ${alsoSiteId}`
      );
      return readings;
    }
  }

  return [];
}

async function fetchSiteDetail(
  baseUrl: string,
  accessToken: string,
  alsoSiteId: number
): Promise<AlsoEnergySiteDetail> {
  const response = await fetch(`${baseUrl}/Sites/${alsoSiteId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AlsoEnergy site detail failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

async function fetchHardwareSnapshot(
  baseUrl: string,
  accessToken: string,
  alsoSiteId: number
): Promise<AlsoEnergyHardwareListResult> {
  const response = await fetch(
    `${baseUrl}/Sites/${alsoSiteId}/Hardware?includeArchivedFields=true&includeSummaryFields=true`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AlsoEnergy hardware list failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

async function fetchBinData(
  baseUrl: string,
  accessToken: string,
  startDate: Date,
  endDate: Date,
  siteTimeZone: string,
  fields: BinDataFieldRequest[]
): Promise<AlsoEnergyDataBinResults> {
  const fromStr = formatLocalTimeInTimeZone(startDate, siteTimeZone);
  const toStr = formatLocalTimeInTimeZone(endDate, siteTimeZone);

  const binDataUrl =
    `${baseUrl}/v2/Data/BinData?` +
    `fromLocalTime=${encodeURIComponent(fromStr)}&` +
    `toLocalTime=${encodeURIComponent(toStr)}&` +
    `binSizes=Bin1Hour&` +
    `tz=${encodeURIComponent(siteTimeZone)}`;

  const response = await fetch(binDataUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(fields),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AlsoEnergy BinData failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

function buildBinDataPlans(
  alsoSiteId: number,
  hardwareSnapshot: AlsoEnergyHardwareListResult
): AlsoEnergyBinPlan[] {
  const summaryFields = hardwareSnapshot.summaryFields ?? [];
  const hardwareList = hardwareSnapshot.hardware ?? [];
  const plans: AlsoEnergyBinPlan[] = [];

  const summaryEnergyField = chooseSummaryField(summaryFields);
  if (summaryEnergyField) {
    plans.push({
      label: `site summary ${summaryEnergyField} DiffNonZero`,
      fields: [{ siteId: alsoSiteId, fieldName: summaryEnergyField, function: "DiffNonZero" }],
      interpretation: "energy_delta",
    });
    plans.push({
      label: `site summary ${summaryEnergyField} Last`,
      fields: [{ siteId: alsoSiteId, fieldName: summaryEnergyField, function: "Last" }],
      interpretation: "energy_cumulative",
    });
  }

  const targetHardware = chooseTargetHardware(hardwareList);
  const energyHardwareFields = buildHardwareFieldRequests(targetHardware, ENERGY_HARDWARE_FIELD_CANDIDATES);
  if (energyHardwareFields.length > 0) {
    plans.push({
      label: "hardware energy DiffNonZero",
      fields: energyHardwareFields.map((field) => ({ ...field, function: "DiffNonZero" as const })),
      interpretation: "energy_delta",
    });
    plans.push({
      label: "hardware energy Last",
      fields: energyHardwareFields.map((field) => ({ ...field, function: "Last" as const })),
      interpretation: "energy_cumulative",
    });
  }

  const powerHardwareFields = buildHardwareFieldRequests(targetHardware, POWER_HARDWARE_FIELD_CANDIDATES);
  if (powerHardwareFields.length > 0) {
    plans.push({
      label: "hardware power Avg",
      fields: powerHardwareFields.map((field) => ({ ...field, function: "Avg" as const })),
      interpretation: "power_average",
    });
  }

  return plans;
}

function chooseSummaryField(summaryFields: string[]): string | null {
  const fieldsByLowerName = new Map(summaryFields.map((field) => [field.toLowerCase(), field]));

  for (const candidate of ENERGY_SUMMARY_FIELD_CANDIDATES) {
    const match = fieldsByLowerName.get(candidate.toLowerCase());
    if (match) {
      return match;
    }
  }

  return summaryFields.find((field) => /prod.*kwh|energy.*kwh/i.test(field)) ?? null;
}

function chooseTargetHardware(hardwareList: AlsoEnergyHardwareItem[]): AlsoEnergyHardwareItem[] {
  const enabledHardware = hardwareList.filter((hardware) => !hardware.flags?.includes("OutOfService"));
  const meters = enabledHardware.filter((hardware) => hardware.functionCode === "PM" || hardware.functionCode === "SM");
  if (meters.length > 0) {
    return meters;
  }

  const inverters = enabledHardware.filter((hardware) => hardware.functionCode === "PV");
  if (inverters.length > 0) {
    return inverters;
  }

  return enabledHardware.slice(0, 1);
}

function buildHardwareFieldRequests(
  hardwareList: AlsoEnergyHardwareItem[],
  candidates: string[]
): Array<Omit<BinDataFieldRequest, "function">> {
  const fields: Array<Omit<BinDataFieldRequest, "function">> = [];

  for (const hardware of hardwareList) {
    const archivedFields = hardware.fieldsArchived ?? [];
    const selectedField = selectCandidateField(archivedFields, candidates);
    if (!selectedField) {
      continue;
    }

    fields.push({
      hardwareId: hardware.id,
      fieldName: selectedField,
    });
  }

  return fields;
}

function selectCandidateField(fields: string[], candidates: string[]): string | null {
  const fieldsByLowerName = new Map(fields.map((field) => [field.toLowerCase(), field]));

  for (const candidate of candidates) {
    const match = fieldsByLowerName.get(candidate.toLowerCase());
    if (match) {
      return match;
    }
  }

  if (candidates === ENERGY_HARDWARE_FIELD_CANDIDATES) {
    return fields.find((field) => /prod.*kwh|kwhdel|energy/i.test(field)) ?? null;
  }

  return fields.find((field) => /^w|kw|p(ac|wr)?|wrcv/i.test(field)) ?? null;
}

function parseBinDataResult(
  result: AlsoEnergyDataBinResults,
  dbSiteId: number,
  interpretation: BinPlanInterpretation,
  siteTimeZone: string
): AlsoEnergyReading[] {
  const info = Array.isArray(result.info) ? result.info : [];
  const items = Array.isArray(result.items) ? result.items : [];
  if (items.length === 0) {
    return [];
  }

  const sortedInfo = [...info].sort((left, right) => left.dataIndex - right.dataIndex);
  const previousSeriesEnergyWh = new Map<number, number>();
  const readings: AlsoEnergyReading[] = [];

  for (const item of items) {
    const timestamp = parseAlsoEnergyTimestamp(item.timestamp, siteTimeZone);
    const values = Array.isArray(item.data) ? item.data : [];
    if (!timestamp || values.length === 0) {
      continue;
    }

    let energyWh = 0;
    let powerW = 0;

    for (const infoItem of sortedInfo) {
      const rawValue = values[infoItem.dataIndex];
      if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
        continue;
      }

      if (interpretation === "power_average") {
        powerW += convertPowerToWatts(rawValue, infoItem.units, infoItem.name);
        continue;
      }

      const currentWh = convertEnergyToWh(rawValue, infoItem.units, infoItem.name);
      if (interpretation === "energy_delta") {
        energyWh += currentWh;
        continue;
      }

      const previousWh = previousSeriesEnergyWh.get(infoItem.dataIndex);
      previousSeriesEnergyWh.set(infoItem.dataIndex, currentWh);
      if (previousWh === undefined) {
        continue;
      }

      const deltaWh = currentWh - previousWh;
      if (deltaWh > 0) {
        energyWh += deltaWh;
      }
    }

    if (interpretation === "power_average") {
      energyWh = powerW;
    } else if (powerW === 0) {
      powerW = energyWh;
    }

    if (energyWh <= 0 && powerW <= 0) {
      continue;
    }

    readings.push({
      siteId: dbSiteId,
      timestamp,
      energyWh: Math.round(Math.max(0, energyWh)),
      powerW: Math.round(Math.max(0, powerW)),
    });
  }

  return readings;
}

function buildSummaryFallbackReadings(
  dbSiteId: number,
  siteDetail: AlsoEnergySiteDetail,
  siteTimeZone: string
): AlsoEnergyReading[] {
  const production = siteDetail.productionData;
  if (!production) {
    return [];
  }

  const readings: AlsoEnergyReading[] = [];
  const yesterdayKwh = production.yesterdayKwh ?? 0;
  const todayKwh = production.todayKwh ?? 0;
  const nowKw = production.nowKw ?? 0;

  console.log(
    `[AlsoEnergy] Production summary fallback - Yesterday: ${yesterdayKwh} kWh, Today: ${todayKwh} kWh, Now: ${nowKw} kW`
  );

  const todayNoon = parseLocalTimeInTimeZone(formatDateTimeParts(getDateTimeParts(new Date(), siteTimeZone), { hour: "12", minute: "00", second: "00" }), siteTimeZone);
  if (!todayNoon) {
    return [];
  }

  if (yesterdayKwh > 0) {
    const yesterdayNoon = new Date(todayNoon.getTime() - 24 * 60 * 60 * 1000);
    readings.push({
      siteId: dbSiteId,
      timestamp: yesterdayNoon,
      energyWh: Math.round(yesterdayKwh * 1000),
      powerW: Math.round((yesterdayKwh * 1000) / 12),
    });
  }

  if (todayKwh > 0) {
    readings.push({
      siteId: dbSiteId,
      timestamp: todayNoon,
      energyWh: Math.round(todayKwh * 1000),
      powerW: nowKw > 0 ? Math.round(nowKw * 1000) : Math.round(todayKwh * 1000),
    });
  }

  return readings;
}

function normalizeHistoryWindowForBinData(
  historyWindow: HistoryWindow,
  siteTimeZone: string
): HistoryWindow | null {
  const start = floorDateToHourInTimeZone(historyWindow.start, siteTimeZone);
  const end = floorDateToHourInTimeZone(historyWindow.end, siteTimeZone);

  if (end <= start) {
    return null;
  }

  return { start, end };
}

function convertEnergyToWh(value: number, units?: string | null, name?: string | null): number {
  switch (units) {
    case "WattHours":
      return value;
    case "MegawattHours":
      return value * 1_000_000;
    case "KilowattHours":
    default:
      if (!units && /wh$/i.test(name ?? "")) {
        return /mwh/i.test(name ?? "") ? value * 1_000_000 : /wh$/i.test(name ?? "") && !/kwh/i.test(name ?? "") ? value : value * 1000;
      }
      return value * 1000;
  }
}

function convertPowerToWatts(value: number, units?: string | null, name?: string | null): number {
  switch (units) {
    case "Watts":
      return value;
    case "Megawatts":
      return value * 1_000_000;
    case "Kilowatts":
    default:
      if (!units && /^w$/i.test(name ?? "")) {
        return value;
      }
      return value * 1000;
  }
}

function resolveAlsoEnergyApiBase(baseUrl?: string): string {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return ALSOENERGY_API_BASE;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === "api.alsoenergy.com") {
      return parsed.origin;
    }
  } catch {
    // ignore invalid custom URLs and fall back to the default API host
  }

  return ALSOENERGY_API_BASE;
}

function buildDefaultAlsoEnergyWindow(): HistoryWindow {
  const end = new Date();
  end.setHours(0, 0, 0, 0);

  const start = new Date(end);
  start.setDate(start.getDate() - 1);

  return { start, end };
}

function chunkDateRange(start: Date, end: Date, chunkDays: number): Array<{ start: Date; end: Date }> {
  const chunks: Array<{ start: Date; end: Date }> = [];
  let cursor = new Date(start);

  while (cursor < end) {
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + chunkDays);
    if (chunkEnd > end) {
      chunkEnd.setTime(end.getTime());
    }

    chunks.push({ start: chunkStart, end: chunkEnd });
    cursor = chunkEnd;
  }

  return chunks;
}

function parseAlsoEnergyTimestamp(value: string | undefined, siteTimeZone: string): Date | null {
  if (!value) {
    return null;
  }

  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return parseLocalTimeInTimeZone(value, siteTimeZone);
}

function parseLocalTimeInTimeZone(value: string, timeZone: string): Date | null {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second = "00"] = match;
  const utcGuess = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  ));

  const offsetMs = getTimeZoneOffsetMs(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offsetMs);
}

function floorDateToHourInTimeZone(date: Date, timeZone: string): Date {
  const parts = getDateTimeParts(date, timeZone);
  return parseLocalTimeInTimeZone(
    formatDateTimeParts(parts, { minute: "00", second: "00" }),
    timeZone
  ) ?? new Date(date);
}

function formatLocalTimeInTimeZone(date: Date, timeZone: string): string {
  return formatDateTimeParts(getDateTimeParts(date, timeZone));
}

function getDateTimeParts(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const result: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      result[part.type] = part.value;
    }
  }

  return result;
}

function formatDateTimeParts(
  parts: Record<string, string>,
  overrides?: Partial<Record<"hour" | "minute" | "second", string>>
): string {
  return `${parts.year}-${parts.month}-${parts.day}T${overrides?.hour ?? parts.hour}:${overrides?.minute ?? parts.minute}:${overrides?.second ?? parts.second}`;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getDateTimeParts(date, timeZone);
  const utcEquivalent = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return utcEquivalent - date.getTime();
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
