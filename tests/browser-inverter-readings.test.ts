import test from "node:test";
import assert from "node:assert/strict";
import { solarEdgeChartReadings } from "../server/scrapers/solaredge-inverters";
import { powerTrackInverterReadings } from "../server/scrapers/alsoenergy-browser";

const start = new Date("2026-11-22T06:00:00Z");
const end = new Date(+start + 86400000);
const now = new Date(+start + 3600000);

test("SolarEdge keeps array positions through null values and rejects ambiguous rows", () => {
  const devices = [{ inverterSerial: "A" }, { inverterSerial: "B" }];
  const rows = solarEdgeChartReadings({ powerUnit: "watt", inverterDataArray: devices,
    invertersDatedPowerList: [
      { measurementTime: start.toISOString(), inverterPowerArray: [null, 0] },
      { measurementTime: now.toISOString(), inverterPowerArray: [1200, null] },
      { measurementTime: start.toISOString(), inverterPowerArray: [300] },
      { measurementTime: end.toISOString(), inverterPowerArray: [5, 5] },
    ],
  }, now);
  assert.deepEqual(rows.map(row => [row.deviceId, row.powerW]), [["solaredge/B", 0], ["solaredge/A", 1200]]);
});

test("PowerTrack reads a single device power series and omits estimates, gaps and future bins", () => {
  const bins = Array(96).fill(null);
  bins[0] = 0;
  bins[1] = 2.5;
  bins[95] = 10;
  const measured = { units: 10, dataBinned: bins };
  const read = (series: (typeof measured & {name?: string})[]) =>
    powerTrackInverterReadings({ series }, "H123", "West roof", start, end, now);
  const rows = read([measured, { ...measured, name: "Estimate" }]);
  assert.deepEqual(rows.map(row => [row.deviceId, row.powerW, row.timestamp]), [
    ["alsoenergy/123", 0, start.toISOString()],
    ["alsoenergy/123", 2500, new Date(+start + 900000).toISOString()],
  ]);
  assert.deepEqual(read([measured, measured]), []);
  assert.deepEqual(read([{ ...measured, units: 11 }]), []);
});
