import test from "node:test";
import assert from "node:assert/strict";
import { parseSmaDailyRows } from "../server/scrapers/sma-browser";
import { validateSmaSite } from "../shared/sma";
import { insertSiteSchema } from "../shared/schema";

test("SMA is accepted with a numeric system ID, not a device path or OAuth URL", () => {
  assert.equal(insertSiteSchema.safeParse({ name: "SMA", url: "https://ennexos.sunnyportal.com/", scraperType: "sma_browser" }).success, true);
  validateSmaSite({ scraperType: "sma_browser", siteIdentifier: "12345678" });
  for (const siteIdentifier of ["", "123,456", "https://login.sma.energy/auth?code=secret", "../123", null]) {
    assert.throws(() => validateSmaSite({ scraperType: "sma_browser", siteIdentifier }));
  }
});

test("daily kWh become Wh on the site's calendar date, including zero", () => {
  const values = parseSmaDailyRows([["09/09/2026", "3,193.66"], ["09/10/2026", "0.00"]], "2026-09", 7, "America/New_York");
  assert.deepEqual(values, [
    { siteId: 7, timestamp: new Date("2026-09-09T04:00:00Z"), energyWh: 3193660, powerW: null },
    { siteId: 7, timestamp: new Date("2026-09-10T04:00:00Z"), energyWh: 0, powerW: null },
  ]);
});

test("daily timestamps track DST rather than using a fixed offset", () => {
  const readings = parseSmaDailyRows([["11/01/2026", "1"], ["11/02/2026", "2"]], "2026-11", 7, "America/New_York");
  assert.equal(readings[0].timestamp.toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(readings[1].timestamp.toISOString(), "2026-11-02T05:00:00.000Z");
});

test("reject stale, missing, duplicate, malformed, and non-energy rows", () => {
  for (const rows of [
    [["08/31/2026", "10"]], [["09/31/2026", "10"]], [["09/09/2026", "—"]],
    [["09/09/2026", "10"], ["09/09/2026", "11"]], [["06.00 AM", "10"]],
    [["09/09/2026", "1,23"]], [["09/09/2026", "-1"]], [["09/09/2026", "10", "99"]],
  ]) assert.throws(() => parseSmaDailyRows(rows, "2026-09", 7, "UTC"));
});
