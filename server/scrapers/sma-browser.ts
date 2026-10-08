import type { Page, Locator } from "playwright";
import type { Site } from "@shared/schema";
import { SMA_PORTAL_URL, smaSiteIdSchema } from "@shared/sma";
import type { HistoryWindow } from "../history";
import { launchScraperChromium } from "./playwright";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
type SmaReading = { siteId: number; timestamp: Date; energyWh: number; powerW: null };

export async function loginSma(page: Page, username: string, password: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());
  let phase = "opening Sunny Portal";
  try {
    // Start a fresh OAuth/PKCE flow, never reuse a copied authorization URL.
    await page.goto(SMA_PORTAL_URL, { waitUntil: "domcontentloaded", timeout: remaining() });
    const rejectCookies = page.getByRole("button", { name: "Reject all", exact: true });
    const login = page.getByRole("button", { name: "Login", exact: true });
    await rejectCookies.or(login).first().waitFor({ state: "visible", timeout: remaining() });
    if (await rejectCookies.isVisible()) await rejectCookies.click({ timeout: remaining() });
    await login.click({ timeout: remaining() });
    phase = "waiting for SMA ID";
    await page.waitForURL(url => url.origin === "https://login.sma.energy", { timeout: remaining() });
    const user = page.getByRole("textbox", { name: "E-mail or user name", exact: true });
    const secret = page.locator('input[type="password"]').filter({ visible: true });
    await user.fill(username, { timeout: remaining() });
    await secret.fill(password, { timeout: remaining() });
    phase = "signing in (check credentials, MFA, or account prompts)";
    await page.getByRole("button", { name: "Log in", exact: true }).click({ timeout: remaining() });
    await page.waitForURL(url => url.origin === new URL(SMA_PORTAL_URL).origin && !url.pathname.startsWith("/login"), { timeout: remaining() });
    await page.getByRole("button", { name: "User settings", exact: true }).waitFor({ timeout: remaining() });
  } catch {
    // Playwright errors can contain fill values and OAuth query strings.
    throw new Error(`SMA login failed while ${phase}. Use an English-language SMA account and complete any required account verification in Sunny Portal.`);
  }
}

export async function scrapeSmaBrowser(site: Site, username: string, password: string, window: HistoryWindow): Promise<SmaReading[]> {
  const id = smaSiteIdSchema.parse(site.siteIdentifier);
  const browser = await launchScraperChromium();
  try {
    const context = await browser.newContext({ locale: "en-US", timezoneId: site.timezone, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const network = { failedRequests: 0, httpErrors: {} as Record<string, number>, pageErrors: 0, failureKinds: {} as Record<string, number> };
    await loginSma(page, username, password);
    // Counts only: never capture response bodies, credentials, or OAuth URLs.
    page.on("requestfailed", request => {
      network.failedRequests++;
      const raw = request.failure()?.errorText || "";
      const kind = /^net::ERR_[A-Z_]+$/.test(raw) ? raw : "other";
      network.failureKinds[kind] = (network.failureKinds[kind] || 0) + 1;
    });
    page.on("response", response => {
      if (response.status() >= 400) {
        const key = String(response.status());
        network.httpErrors[key] = (network.httpErrors[key] || 0) + 1;
      }
    });
    page.on("pageerror", () => { network.pageErrors++; });
    await page.goto(`${SMA_PORTAL_URL}${id}/monitoring/view-energy-and-power`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Energy and power - PV", exact: true }).waitFor();
    if (new URL(page.url()).pathname !== `/${id}/monitoring/view-energy-and-power`) {
      throw new Error("SMA redirected to a different system; check the system ID and account access.");
    }
    try {
      await waitForSmaChart(page, id);
      return await readSmaDailyHistory(page, site, window);
    } catch {
      const diagnostics = await collectSmaDiagnostics(page).catch(() => ({ unavailable: true }));
      throw new Error(`SMA chart read failed. Diagnostics: ${JSON.stringify({ ...diagnostics, network })}`);
    }
  } finally {
    await browser.close();
  }
}

// The page heading belongs to the application shell, not the async chart.
// Recover once from a stalled initial load, before reading any measurements.
export async function waitForSmaChart(page: Page, systemId: string, timeoutMs = 30_000): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = new URL(page.url());
    if (url.origin !== new URL(SMA_PORTAL_URL).origin || url.pathname !== `/${systemId}/monitoring/view-energy-and-power`) {
      throw new Error("SMA left the requested system page; check session and system access.");
    }
    const rejectCookies = page.getByRole("button", { name: "Reject all", exact: true });
    if (await rejectCookies.isVisible()) await rejectCookies.click();
    try {
      await page.getByRole("combobox").first().waitFor({ state: "visible", timeout: timeoutMs });
      return;
    } catch {
      if (attempt === 1) throw new Error("SMA chart did not initialize after one reload.");
      await page.reload({ waitUntil: "domcontentloaded" });
    }
  }
}

async function choices(page: Page, control: Locator): Promise<string[]> {
  if (!(await control.isEnabled())) return [(await control.innerText()).trim()];
  await control.click();
  const options = page.getByRole("option");
  await options.first().waitFor();
  const labels = (await options.allTextContents()).map(label => label.trim());
  await control.press("Escape");
  return labels;
}

async function selectChoice(page: Page, control: Locator, label: string): Promise<void> {
  if ((await control.innerText()).trim() === label) return;
  await control.click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.waitForFunction(({ index, expected }) => {
    const controls = document.querySelectorAll('[role="combobox"]');
    return controls[index]?.textContent?.trim() === expected;
  }, { index: /^\d{4}$/.test(label) ? 2 : 1, expected: label });
}

export async function readSmaDailyHistory(page: Page, site: Pick<Site, "id" | "timezone">, window: HistoryWindow): Promise<SmaReading[]> {
  // Sunny Portal renders the chart in a generic container, without a main landmark.
  const resolution = page.getByRole("combobox").nth(0);
  await resolution.click();
  await page.getByRole("option", { name: "Month", exact: true }).click();
  const details = page.getByRole("button", { name: "Details", exact: true });
  if (await details.getAttribute("aria-expanded") !== "true") await details.click();
  const controls = page.getByRole("combobox");
  await controls.nth(2).waitFor();
  // Date controls can appear before the initial power-to-energy transition
  // finishes. Do not start another chart request during that transition.
  await page.getByRole("region", { name: "Details", exact: true })
    .getByRole("columnheader", { name: /Total yield\s*\[kWh\]/ }).waitFor();
  const startDate = calendarDate(window.start, site.timezone);
  const endDate = calendarDate(window.end, site.timezone);
  const result: SmaReading[] = [];
  const years = await choices(page, controls.nth(2));
  if (!years.length || years.some(year => !/^\d{4}$/.test(year))) throw new Error("SMA year selector changed; expected English month/year controls.");
  for (const year of years.filter(year => +year >= +startDate.slice(0, 4) && +year <= +endDate.slice(0, 4)).sort()) {
    await selectChoice(page, controls.nth(2), year);
    const months = await choices(page, controls.nth(1));
    if (!months.length || months.some(month => !MONTHS.includes(month))) throw new Error("SMA month selector changed; use English portal language.");
    for (const month of months) {
      const monthKey = `${year}-${String(MONTHS.indexOf(month) + 1).padStart(2, "0")}`;
      if (monthKey < startDate.slice(0, 7) || monthKey > endDate.slice(0, 7)) continue;
      await selectChoice(page, controls.nth(1), month);
      // SMA retains the previous table during async chart updates, even after
      // the date selector changes. Require energy units and matching row dates.
      await page.waitForFunction(({ month, year }) => {
        const table = document.querySelector('[role="region"] table, [role="region"] [role="table"]');
        if (!table) return false;
        const rows = Array.from(table.querySelectorAll('tr, [role="row"]'));
        if (!rows[0]?.textContent?.match(/Total yield\s*\[kWh\]/)) return false;
        const data = rows.slice(1);
        return data.length > 0 && data.every(row => {
          const text = row.querySelector('td, [role="cell"]')?.textContent?.trim() ?? "";
          const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
          return match && +match[1] === month && +match[3] === year;
        });
      }, { month: MONTHS.indexOf(month) + 1, year: +year }, { timeout: 30_000 });
      const table = page.getByRole("region", { name: "Details", exact: true }).getByRole("table");
      // Read header and cells in one DOM snapshot. A live refresh between
      // individual row reads must not mix two chart versions together.
      const snapshot = await table.evaluate(element => {
        const rows = Array.from(element.querySelectorAll('tr, [role="row"]'));
        return {
          header: rows[0]?.textContent ?? "",
          values: rows.slice(1).map(row => Array.from(row.querySelectorAll('td, [role="cell"]')).map(cell => cell.textContent ?? "")),
        };
      });
      if (!/Total yield\s*\[kWh\]/.test(snapshot.header) || !snapshot.values.length) {
        throw new Error("SMA energy table changed during the read; retry sync.");
      }
      const values = snapshot.values;
      const readings = parseSmaDailyRows(values, monthKey, site.id, site.timezone);
      result.push(...readings.filter(row => {
        const date = calendarDate(row.timestamp, site.timezone);
        return date >= startDate && date <= endDate;
      }));
    }
  }
  if (!result.length) throw new Error("SMA returned no dated production readings in the requested history window.");
  return result;
}

export function parseSmaDailyRows(rows: string[][], month: string, siteId: number, timezone: string): SmaReading[] {
  const seen = new Set<string>();
  return rows.map(cells => {
    if (cells.length !== 2) throw new Error("SMA daily energy table has unexpected columns.");
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(cells[0].trim());
    if (!match) throw new Error("SMA daily energy date is invalid; expected MM/DD/YYYY.");
    const date = `${match[3]}-${match[1]}-${match[2]}`;
    if (!date.startsWith(`${month}-`) || seen.has(date) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) {
      throw new Error("SMA daily energy table contains duplicate, invalid, or stale dates.");
    }
    seen.add(date);
    const value = cells[1].trim();
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)) throw new Error("SMA daily yield is missing or invalid.");
    const energyWh = Number(value.replaceAll(",", "")) * 1000;
    if (!Number.isFinite(energyWh)) throw new Error("SMA daily yield is not finite.");
    return { siteId, timestamp: localMidnight(date, timezone), energyWh, powerW: null };
  });
}

function calendarDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function localMidnight(date: string, timeZone: string): Date {
  const target = Date.parse(`${date}T00:00:00Z`);
  let timestamp = target;
  const format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = format.formatToParts(new Date(timestamp));
    const get = (type: string) => parts.find(part => part.type === type)!.value;
    const represented = Date.parse(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`);
    if (represented === target) return new Date(timestamp);
    timestamp += target - represented;
  }
  throw new Error("SMA date cannot be represented at midnight in the configured timezone.");
}

// Expose only allowlisted labels and structural counts; arbitrary portal text
// can contain account information, tokens, or credentials.
export async function collectSmaDiagnostics(page: Page) {
  const route = new URL(page.url());
  const location = route.hostname === "ennexos.sunnyportal.com"
    ? (route.pathname.endsWith("/monitoring/view-energy-and-power") ? "energy-page" : "other-portal-page")
    : "outside-portal";
  return { location, ...await page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll('[role="combobox"]'));
    const text = document.body.innerText;
    return {
      readyState: document.readyState,
      comboboxes: controls.length,
      visibleComboboxes: controls.filter(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      }).length,
      controls: controls.slice(0, 8).map(element => ({
        label: /^(Day|Week|Month|Year|Total)$/.test(element.textContent?.trim() || "") ? element.textContent!.trim() : "redacted",
        hiddenFromAccessibility: !!element.closest('[aria-hidden="true"], [inert]'),
        disabled: element.getAttribute("aria-disabled") === "true",
      })),
      dialogs: document.querySelectorAll('[role="dialog"], [aria-modal="true"]').length,
      visibleDialogs: Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
      }).length,
      frames: document.querySelectorAll("iframe").length,
      busy: document.querySelectorAll('[aria-busy="true"], [role="progressbar"]').length,
      signals: {
        noData: /no data available/i.test(text),
        accessDenied: /access denied|not authorized|permission denied/i.test(text),
        sessionExpired: /session expired|session has expired/i.test(text),
        portalError: /something went wrong|temporarily unavailable|error loading/i.test(text),
      },
    };
  }) };
}
