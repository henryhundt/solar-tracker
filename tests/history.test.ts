import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIncrementalHistoryWindow,
  getHourlyHistoryCutoff,
  HOURLY_HISTORY_OVERLAP_HOURS,
} from "../server/history";

test("an empty history requests the full retention window", () => {
  const now = new Date("2026-08-28T12:00:00.000Z");
  const window = buildIncrementalHistoryWindow({ earliest: null, latest: null, count: 0 }, now);

  assert.equal(window.start.getTime(), getHourlyHistoryCutoff(now).getTime());
  assert.equal(window.end.getTime(), now.getTime());
});

test("an incomplete backfill continues from the retention cutoff", () => {
  const now = new Date("2026-08-28T12:00:00.000Z");
  const cutoff = getHourlyHistoryCutoff(now);
  const window = buildIncrementalHistoryWindow({
    earliest: new Date(cutoff.getTime() + 24 * 60 * 60 * 1000),
    latest: new Date("2026-08-27T12:00:00.000Z"),
    count: 24,
  }, now);

  assert.equal(window.start.getTime(), cutoff.getTime());
});

test("a complete history refreshes with the configured overlap", () => {
  const now = new Date("2026-08-28T12:00:00.000Z");
  const latest = new Date("2026-08-27T12:00:00.000Z");
  const window = buildIncrementalHistoryWindow({
    earliest: new Date("2024-01-01T00:00:00.000Z"),
    latest,
    count: 1000,
  }, now);

  assert.equal(
    window.start.getTime(),
    latest.getTime() - HOURLY_HISTORY_OVERLAP_HOURS * 60 * 60 * 1000,
  );
});
