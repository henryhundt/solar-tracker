import { z } from "zod";
import type { InverterFaultSnapshot } from "@shared/inverters";

const summarySchema = z.object({
  totalAlertsCount: z.number().int().nonnegative(),
  topAlerts: z.array(z.object({
    alertType: z.string().min(1),
    alertsCount: z.number().int().positive(),
    deviceName: z.string().nullish(),
    lastReportedAt: z.string().datetime({ offset: true }).nullish(),
    creationDate: z.string().datetime({ offset: true }).nullish(),
  })),
});

export function solarEdgeFaultSnapshots(payload: unknown, devices: Map<string, string>, checkedAt: string): InverterFaultSnapshot[] {
  const summary = summarySchema.parse(payload);
  const snapshots = Array.from(devices, ([serial, name]): InverterFaultSnapshot => ({
    deviceId: `solaredge/${serial}`, name, checkedAt, complete: true, faults: [],
  }));
  let complete = summary.topAlerts.reduce((n, group) => n + group.alertsCount, 0) === summary.totalAlertsCount;
  for (const group of summary.topAlerts) {
    if (/^(PANEL|STRING|SITE|OPTIMIZER)_/.test(group.alertType)) continue;
    const matches = snapshots.filter(row => row.name === group.deviceName || row.deviceId === `solaredge/${group.deviceName}`);
    if (matches.length !== 1 || group.alertsCount !== 1) {
      complete = false;
      continue;
    }
    matches[0].faults.push({ code: group.alertType, lastReportedAt: group.lastReportedAt ?? null, openedAt: group.creationDate ?? undefined });
  }
  return snapshots.map(row => ({ ...row, complete }));
}
