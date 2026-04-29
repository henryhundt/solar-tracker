import type { Site } from "@shared/schema";
import { getLegacyEGaugeRegisterName, getSelectedEGaugeRegisters } from "@shared/egauge";
import type { HistoryWindow } from "../history";
import {
  fetchEGaugeRegisterHistory,
  inspectEGaugeRegisters,
  resolveEGaugeAccess,
} from "./egauge-client";

interface EGaugeReading {
  siteId: number;
  timestamp: Date;
  energyWh: number;
  powerW: number;
}

interface HistoricalRange {
  ts?: number | string;
  delta?: number | string;
  rows?: Array<Array<number | string | null>>;
}

const DEFAULT_HISTORY_DELTA_SECONDS = 3600;
const EGAUGE_HISTORY_CHUNK_HOURS = 24 * 30;
const MIN_SIGNIFICANT_GENERATION_WH = 20;

export async function scrapeEGauge(
  site: Site,
  url: string,
  username?: string,
  password?: string,
  historyWindow?: HistoryWindow
): Promise<EGaugeReading[]> {
  console.log(`[eGauge] Starting API scrape for ${site.name}`);

  const access = resolveEGaugeAccess({ url, username, password });
  const selectedRegisterIds = await resolveRegisterIdsForSite(site, access);

  const defaultEnd = new Date();
  defaultEnd.setMinutes(0, 0, 0);
  const defaultStart = new Date(defaultEnd);
  defaultStart.setDate(defaultStart.getDate() - 1);

  const startTs = Math.floor((historyWindow?.start ?? defaultStart).getTime() / 1000);
  const endTs = Math.floor((historyWindow?.end ?? defaultEnd).getTime() / 1000);
  const readingsByTimestamp = new Map<number, EGaugeReading>();

  for (const chunk of chunkHistoryWindow(startTs, endTs, EGAUGE_HISTORY_CHUNK_HOURS)) {
    const history = await fetchEGaugeRegisterHistory(
      access,
      selectedRegisterIds,
      chunk.startTs,
      DEFAULT_HISTORY_DELTA_SECONDS,
      chunk.endTs
    );

    const chunkReadings = buildHourlyReadings(
      site.id,
      history.ranges ?? [],
      DEFAULT_HISTORY_DELTA_SECONDS,
      chunk.startTs,
      chunk.endTs
    );

    for (const reading of chunkReadings) {
      readingsByTimestamp.set(reading.timestamp.getTime(), reading);
    }
  }

  const readings = Array.from(readingsByTimestamp.values()).sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime()
  );

  if (readings.length === 0) {
    throw new Error("No eGauge historical readings were returned for the selected registers");
  }

  console.log(`[eGauge] Retrieved ${readings.length} readings for ${site.name}`);
  return readings;
}

async function resolveRegisterIdsForSite(
  site: Site,
  access: ReturnType<typeof resolveEGaugeAccess>
): Promise<number[]> {
  const selectedRegisters = getSelectedEGaugeRegisters(site);
  if (selectedRegisters.length > 0) {
    return selectedRegisters.map((register) => register.idx);
  }

  const availableRegisters = await inspectEGaugeRegisters(access);
  const legacyRegisterName = getLegacyEGaugeRegisterName(site)?.toLowerCase();
  if (legacyRegisterName) {
    const legacyMatches = availableRegisters
      .filter((register) => register.name.toLowerCase() === legacyRegisterName)
      .map((register) => register.idx);

    if (legacyMatches.length > 0) {
      return legacyMatches;
    }

    const partialMatches = availableRegisters
      .filter((register) => register.name.toLowerCase().includes(legacyRegisterName))
      .map((register) => register.idx);

    if (partialMatches.length > 0) {
      return partialMatches;
    }

    throw new Error(`Legacy eGauge register "${getLegacyEGaugeRegisterName(site)}" was not found on the meter`);
  }

  const recommendedRegisters = availableRegisters
    .filter((register) => register.isRecommendedSolar)
    .map((register) => register.idx);

  if (recommendedRegisters.length > 0) {
    return recommendedRegisters;
  }

  throw new Error("No eGauge production registers are configured. Re-open the site and select registers.");
}

function buildHourlyReadings(
  siteId: number,
  ranges: HistoricalRange[],
  expectedDeltaSeconds: number,
  windowStartTs?: number,
  windowEndTs?: number
): EGaugeReading[] {
  const readingsByTimestamp = new Map<number, EGaugeReading>();

  for (const range of ranges) {
    const rangeEndTs = toFiniteNumber(range.ts);
    if (rangeEndTs === null) {
      continue;
    }

    const deltaSeconds = toFiniteNumber(range.delta) ?? expectedDeltaSeconds;
    const rows = range.rows ?? [];
    if (rows.length < 2) {
      continue;
    }

    for (let newerIndex = rows.length - 2; newerIndex >= 0; newerIndex -= 1) {
      const newerRow = rows[newerIndex];
      const olderRow = rows[newerIndex + 1];
      if (!newerRow || !olderRow) {
        continue;
      }

      const intervalEndTs = rangeEndTs - newerIndex * deltaSeconds;
      if (windowStartTs !== undefined && intervalEndTs <= windowStartTs) {
        continue;
      }
      if (windowEndTs !== undefined && intervalEndTs > windowEndTs) {
        continue;
      }
      let totalPositiveDeltaWs = 0;

      for (let columnIndex = 0; columnIndex < newerRow.length; columnIndex += 1) {
        const newerValue = toFiniteNumber(newerRow[columnIndex]);
        const olderValue = toFiniteNumber(olderRow[columnIndex]);
        if (newerValue === null || olderValue === null) {
          continue;
        }

        const deltaWs = newerValue - olderValue;
        if (deltaWs > 0) {
          totalPositiveDeltaWs += deltaWs;
        }
      }

      if (totalPositiveDeltaWs <= 0) {
        continue;
      }

      const energyWh = totalPositiveDeltaWs / 3600;
      if (energyWh < MIN_SIGNIFICANT_GENERATION_WH) {
        continue;
      }

      const powerW = totalPositiveDeltaWs / deltaSeconds;

      readingsByTimestamp.set(intervalEndTs, {
        siteId,
        timestamp: new Date(intervalEndTs * 1000),
        energyWh: Math.round(energyWh),
        powerW: Math.round(powerW),
      });
    }
  }

  return Array.from(readingsByTimestamp.values()).sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime()
  );
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function chunkHistoryWindow(
  startTs: number,
  endTs: number,
  chunkHours: number
): Array<{ startTs: number; endTs: number }> {
  const chunks: Array<{ startTs: number; endTs: number }> = [];
  const chunkSeconds = chunkHours * DEFAULT_HISTORY_DELTA_SECONDS;
  let cursor = startTs;

  while (cursor < endTs) {
    const chunkEndTs = Math.min(endTs, cursor + chunkSeconds);
    chunks.push({
      startTs: cursor,
      endTs: chunkEndTs,
    });
    cursor = chunkEndTs;
  }

  return chunks;
}
