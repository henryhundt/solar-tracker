import { solarEdgeFaultSnapshots } from "./solaredge-faults";
import type { InverterFaultSnapshot, InverterReading } from "@shared/inverters";
import { formatLocalTimeInTimeZone } from "../provider-time";
import type { SolarEdgeRequest } from "./solaredge-session";

interface InverterChart {
  inverterDataArray: { inverterName?: string; inverterSerial: string }[];
  invertersDatedPowerList: { measurementTime: string; inverterPowerArray: (number | null)[] }[];
  powerUnit: string;
}

export function solarEdgeChartReadings(chart: InverterChart, now: Date): InverterReading[] {
  const scale = { watt: 1, kilowatt: 1000 }[chart.powerUnit?.toLowerCase()];
  if (!scale) throw new Error("Unrecognized inverter chart power unit");
  const readings: InverterReading[] = [];
  for (const point of chart.invertersDatedPowerList) {
    const date = Date.parse(point.measurementTime);
    if (!Number.isFinite(date) || date > now.getTime() || point.inverterPowerArray?.length !== chart.inverterDataArray.length) continue;
    point.inverterPowerArray.forEach((power, index) => {
      const device = chart.inverterDataArray[index];
      if (!device.inverterSerial || typeof power !== "number" || !Number.isFinite(power)) return;
      readings.push({ deviceId: `solaredge/${device.inverterSerial}`, name: device.inverterName || device.inverterSerial,
        timestamp: new Date(date).toISOString(), powerW: power * scale });
    });
  }
  return readings;
}

export async function readSolarEdgeBrowserInverters(request: SolarEdgeRequest, siteId: string, timezone: string,
  save: (rows: InverterReading[]) => Promise<void>, now = new Date(), saveFaults?: (rows: InverterFaultSnapshot[]) => Promise<void>) {
  const localDay = (date: Date) => formatLocalTimeInTimeZone(date, timezone).slice(0, 10);
  const params = new URLSearchParams({
    "start-date": localDay(new Date(now.getTime() - 2 * 86400000)),
    "end-date": localDay(now), normalized: "false", "chart-time-unit": "hours",
  });
  const seen = new Map<string, string>();
  for (let page = 0; ; page++) {
    params.set("page-number", String(page));
    const response = await request.get(`https://monitoring.solaredge.com/services/dashboard/inverters/power/sites/${encodeURIComponent(siteId)}?${params}`);
    if (!response.ok()) {
      if (page && [400, 404].includes(response.status())) break;
      throw new Error(`Inverter chart unavailable (HTTP ${response.status()})`);
    }
    const chart: InverterChart = await response.json();
    const serials = chart.inverterDataArray.map(device => device.inverterSerial).filter(Boolean);
    if (serials.every(serial => seen.has(serial))) break;
    await save(solarEdgeChartReadings(chart, now).filter(row => !seen.has(row.deviceId.slice("solaredge/".length))));
    for (const device of chart.inverterDataArray) {
      if (device.inverterSerial) seen.set(device.inverterSerial, device.inverterName || device.inverterSerial);
    }
  }
  if (saveFaults && seen.size) {
    const response = await request.get(`https://monitoring.solaredge.com/services/dashboard/alerts/sites/${encodeURIComponent(siteId)}`);
    if (response.ok()) await saveFaults(solarEdgeFaultSnapshots(await response.json(), seen, new Date().toISOString()));
  }

}
