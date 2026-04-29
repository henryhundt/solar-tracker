import type { ReadingBounds } from "./storage";

export interface HistoryWindow {
  start: Date;
  end: Date;
}

export const HOURLY_HISTORY_MONTHS = 18;
export const HOURLY_HISTORY_OVERLAP_HOURS = 48;

export function getHourlyHistoryCutoff(now = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - HOURLY_HISTORY_MONTHS);
  return cutoff;
}

export function buildIncrementalHistoryWindow(
  bounds: ReadingBounds,
  now = new Date()
): HistoryWindow {
  const end = new Date(now);
  const cutoff = getHourlyHistoryCutoff(now);

  if (!bounds.latest) {
    return { start: cutoff, end };
  }

  // Many providers only emit daylight production rows and omit zero-output hours,
  // so row count is not a reliable proxy for backfill completeness.
  if (!bounds.earliest || bounds.earliest > cutoff) {
    return { start: cutoff, end };
  }

  const start = new Date(bounds.latest);
  start.setHours(start.getHours() - HOURLY_HISTORY_OVERLAP_HOURS);

  return {
    start: start < cutoff ? cutoff : start,
    end,
  };
}
