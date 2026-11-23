import type { InverterReading } from "@shared/inverters";
import type { Site } from "@shared/schema";
import { getSelectedEGaugeRegisters } from "@shared/egauge";
import { inspectEGaugeRegisters, resolveEGaugeAccess } from "./egauge-client";
import { fetchWithTimeout } from "../provider-http";
import { formatLocalTimeInTimeZone, parseLocalTimeInTimeZone } from "../provider-time";

export async function readEGaugeInverters(site: Site, access: ReturnType<typeof resolveEGaugeAccess>) {
  const selected = getSelectedEGaugeRegisters(site);
  const registers = await inspectEGaugeRegisters(access);
  return registers.flatMap(register => {
    if (selected.length && !selected.some(item => item.idx === register.idx)) return [];
    if (register.type !== "P" || !/\b(?:inverter|inv)[\s#_-]*\d+\b/i.test(register.name) || typeof register.rate !== "number") return [];
    if (register.measuredAtSeconds == null) return [];
    const timestamp = new Date(register.measuredAtSeconds * 1000).toISOString();
    return [{ deviceId: `egauge/${register.idx}`, name: register.name, timestamp, powerW: register.rate }];
  });
}

export async function readSolarEdgeInverters(site: Site, apiKey: string, save: (rows: InverterReading[]) => Promise<void>) {
  const siteId = encodeURIComponent(site.siteIdentifier ?? "");
  const query = new URLSearchParams({ api_key: apiKey });
  const base = "https://monitoringapi.solaredge.com";
  const response = await fetchWithTimeout(`${base}/site/${siteId}/inventory?${query}`);
  if (!response.ok) throw new Error("SolarEdge inventory unavailable");
  type Device = { SN?: string; serialNumber?: string; name?: string };
  const { Inventory } = await response.json() as { Inventory: { inverters?: Device[]; thirdPartyInverters?: Device[] } };
  const now = new Date();
  query.set("startTime", formatLocalTimeInTimeZone(new Date(now.getTime() - 86400000), site.timezone).replace("T", " "));
  query.set("endTime", formatLocalTimeInTimeZone(now, site.timezone).replace("T", " "));
  for (const device of [...(Inventory.inverters ?? []), ...(Inventory.thirdPartyInverters ?? [])]) {
    const serial = device.serialNumber || device.SN;
    if (!serial) continue;
    const telemetry = await fetchWithTimeout(`${base}/equipment/${siteId}/${encodeURIComponent(serial)}/data?${query}`);
    if (telemetry.status === 429) break;
    if (!telemetry.ok) continue;
    const body = await telemetry.json() as { data: { telemetries: Array<{ date: string; totalActivePower?: number }> } };
    const rows = body.data.telemetries.flatMap(point => {
      const timestamp = parseLocalTimeInTimeZone(point.date.replace(" ", "T"), site.timezone);
      if (!timestamp || typeof point.totalActivePower !== "number" || !Number.isFinite(point.totalActivePower)) return [];
      return [{ deviceId: `solaredge/${serial}`, name: device.name || serial, timestamp: timestamp.toISOString(), powerW: point.totalActivePower }];
    });
    await save(rows);
  }
}
