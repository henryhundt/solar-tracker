import assert from "node:assert/strict";
import test from "node:test";
import { solarEdgeFaultSnapshots } from "../server/scrapers/solaredge-faults";
import { smaFaultSnapshots } from "../server/scrapers/sma-faults";
const checked = "2026-11-23T12:00:00Z";
const reported = "2026-11-23T10:00:00Z";
const devices = new Map([["10", "Inverter 1"], ["11", "Inverter 2"]]);

test("SolarEdge separates single-device alerts, grouped alerts and an explicit clear", () => {
  const group = { alertType: "INVERTER_FAULT", alertsCount: 1, deviceName: "Inverter 1", creationDate: reported };
  const result = solarEdgeFaultSnapshots({ totalAlertsCount: 3, topAlerts: [group] }, devices, checked);
  assert.deepEqual(result[0].faults, [{ code: group.alertType, lastReportedAt: null, openedAt: reported }]);
  assert.equal(result[0].complete, false);
  assert.deepEqual(result[1].faults, []);
  assert.equal(solarEdgeFaultSnapshots({ totalAlertsCount: 0, topAlerts: [] }, devices, checked)[0].complete, true);
  assert.throws(() => solarEdgeFaultSnapshots({}, devices, checked));
});

test("SMA keeps the latest transition per inverter and event code, even out of order", () => {
  const open = { plantId: "123", deviceId: "10", messageId: 6107, timestamp: reported, traceLevel: "Warn", eventTypeExtension: "Incoming" };
  const result = smaFaultSnapshots([{ ...open, timestamp: checked, eventTypeExtension: "Outgoing" }, open,
    { ...open, deviceId: "11" }, { ...open, plantId: "456" }], "123", devices, checked);
  assert.deepEqual(result[0].faults, []);
  assert.deepEqual(result[1].faults, [{ code: "6107", description: "SMA warning", lastReportedAt: new Date(reported).toISOString() }]);
  assert.equal(result[1].complete, false);
});
