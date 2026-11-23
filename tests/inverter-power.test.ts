import assert from "node:assert/strict";
import test from "node:test";
import type { Site } from "../shared/schema";
import type { InverterReading } from "../shared/inverters";
import { readSolarEdgeInverters } from "../server/scrapers/inverter-power";

test("SolarEdge keeps devices separate, preserves zero and skips missing power", async t => {
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const path = new URL(input).pathname;
    if (path.endsWith("/inventory")) {
      return Response.json({ Inventory: { inverters: [{ serialNumber: "A" }], thirdPartyInverters: [{ SN: "B" }] } });
    }
    const totalActivePower = path.includes("/A/") ? 0 : 1400;
    return Response.json({ data: { telemetries: [
      { date: "2026-11-20 14:00:00", totalActivePower },
      { date: "2026-11-20 14:05:00", totalActivePower: null },
    ] } });
  });
  const rows: InverterReading[] = [];
  await readSolarEdgeInverters({ siteIdentifier: "3", timezone: "America/Chicago" } as Site, "test", async batch => { rows.push(...batch); });
  assert.deepEqual(rows.map(row => [row.deviceId, row.powerW, row.timestamp]), [
    ["solaredge/A", 0, "2026-11-20T20:00:00.000Z"],
    ["solaredge/B", 1400, "2026-11-20T20:00:00.000Z"],
  ]);
});
