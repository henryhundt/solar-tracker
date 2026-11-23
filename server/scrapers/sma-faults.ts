import type { Page } from "playwright";
import { SMA_PORTAL_URL } from "@shared/sma";
import type { InverterFaultSnapshot } from "@shared/inverters";

interface Event {
  plantId: string;
  deviceId: string;
  messageId: number;
  timestamp: string;
  lastAppearanceTimestamp?: string | null;
  traceLevel: string;
  eventTypeExtension: string;
}

export function smaFaultSnapshots(events: Event[], plantId: string, devices: Map<string, string>, checkedAt: string): InverterFaultSnapshot[] {
  const latest = new Map<string, Event>();
  for (const event of events) {
    if (String(event.plantId) !== plantId || !devices.has(String(event.deviceId)) || !Number.isInteger(event.messageId)
      || !Number.isFinite(Date.parse(event.timestamp)) || !["Incoming", "Outgoing"].includes(event.eventTypeExtension)) continue;
    const key = `${event.deviceId}/${event.messageId}`;
    const previous = latest.get(key);
    if (!previous || Date.parse(event.timestamp) > Date.parse(previous.timestamp)
      || (Date.parse(event.timestamp) === Date.parse(previous.timestamp) && event.eventTypeExtension === "Outgoing")) latest.set(key, event);
  }
  return Array.from(devices, ([id, name]) => ({
    deviceId: `sma/${id}`, name, checkedAt, complete: false,
    faults: Array.from(latest.values()).filter(event => String(event.deviceId) === id && event.eventTypeExtension === "Incoming"
      && ["Warn", "Error"].includes(event.traceLevel)).map(event => ({
      code: String(event.messageId), description: event.traceLevel === "Warn" ? "SMA warning" : "SMA error",
      lastReportedAt: new Date(Math.max(Date.parse(event.timestamp), Date.parse(event.lastAppearanceTimestamp ?? "") || 0)).toISOString(),
    })),
  }));
}

export async function readSmaFaults(page: Page, plantId: string, devices: Map<string, string>) {
  const endpoint = "https://uiapi.sunnyportal.com/api/v1/customermessages/search";
  const checkedAt = new Date().toISOString();
  const [response] = await Promise.all([
    page.waitForResponse(r => r.ok() && r.url() === endpoint && r.request().method() === "POST"
      && String(r.request().postDataJSON()?.componentId) === plantId, { timeout: 15000 }),
    page.goto(new URL(`${plantId}/monitoring/view-customer-messages`, SMA_PORTAL_URL).href, { waitUntil: "domcontentloaded" }),
  ]);
  const initial = response.request();
  const query = initial.postDataJSON();
  if (query.offset !== 0 || [query.deviceIds, query.traceLevels, query.messageGroupTags, query.deviceProductGroupTagIds]
    .some(filter => !Array.isArray(filter) || filter.length)) throw new Error("SMA event monitor has active filters");
  const events: Event[] = await response.json();
  if (!Array.isArray(events)) throw new Error("SMA event list unavailable");
  const pageSize = events.length;
  if (pageSize) {
    const authorization = await initial.headerValue("authorization");
    if (authorization) {
      for (let index = 1; index < 10; index++) {
        const next = await page.context().request.post(endpoint, { headers: { Authorization: authorization },
          maxRedirects: 0, timeout: 10000, data: { ...query, offset: events.length } });
        if (!next.ok()) break;
        const batch: Event[] = await next.json();
        if (!Array.isArray(batch) || !batch.length || batch[0]?.timestamp === events[0]?.timestamp && batch[0]?.deviceId === events[0]?.deviceId) break;
        events.push(...batch);
        if (batch.length < pageSize) break;
      }
    }
  }
  return smaFaultSnapshots(events, plantId, devices, checkedAt);
}
