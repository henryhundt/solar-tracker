import type { Page, Response } from "playwright";
import { SMA_PORTAL_URL } from "@shared/sma";
import { readSmaFaults } from "./sma-faults";
import type { InverterFaultSnapshot, InverterReading } from "@shared/inverters";

function isDeviceWidget(response: Response, path: string, deviceId: string, plantId: string) {
  const url = new URL(response.url());
  return response.ok() && url.origin === "https://uiapi.sunnyportal.com" &&
    url.pathname === `/api/v1/widgets/${path}` &&
    (path === "deviceinfo"
      ? url.searchParams.get("deviceId") === deviceId && url.searchParams.get("plantId") === plantId
      : url.searchParams.get("componentId") === deviceId && url.searchParams.get("type") === "PvProduction");
}

export async function readSmaInverters(page: Page, plantId: string, save: (rows: InverterReading[]) => Promise<void>, saveFaults?: (rows: InverterFaultSnapshot[]) => Promise<void>) {
  await page.getByRole("button", { name: "Select Device", exact: true }).click();
  const links = page.locator(`a[href^="/${plantId},"][href$="/dashboard"]`);
  await links.first().waitFor({ timeout: 10000 });
  const paths = await links.evaluateAll(elements => elements.map(el => el.getAttribute("href")));
  const devices = new Map<string, string>();
  for (const path of Array.from(new Set(paths))) {
    const match = path?.match(/^\/(\d+),(\d+)\/dashboard$/);
    if (!match || match[1] !== plantId) continue;
    const deviceId = match[2];
    try {
      const [info, gauge] = await Promise.all([
        page.waitForResponse(r => isDeviceWidget(r, "deviceinfo", deviceId, plantId), { timeout: 15000 }).then(r => r.json()),
        page.waitForResponse(r => isDeviceWidget(r, "gauge/power", deviceId, plantId), { timeout: 15000 }).then(r => r.json()).catch(() => null),
        page.goto(new URL(path!, SMA_PORTAL_URL).href, { waitUntil: "domcontentloaded" }),
      ]);
      if (String(info.deviceId) !== deviceId || String(info.plantId) !== plantId || Number(info.productGroupTagId) !== 8001) continue;
      devices.set(deviceId, info.name || `Inverter ${deviceId}`);
      if (typeof gauge?.value !== "number" || !Number.isFinite(gauge.value) || !Number.isFinite(Date.parse(gauge.timestamp))) continue;
      await save([{ deviceId: `sma/${deviceId}`, name: info.name || `Inverter ${deviceId}`,
        timestamp: new Date(gauge.timestamp).toISOString(), powerW: gauge.value }]);
    } catch {
      console.warn(`[SMA] Device ${deviceId} power unavailable`);
    }
  }
  if (saveFaults && devices.size) await saveFaults(await readSmaFaults(page, plantId, devices));
}
