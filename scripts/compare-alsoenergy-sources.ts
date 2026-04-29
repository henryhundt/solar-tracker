import { chromium, type Page } from "playwright";

const POWERTRACK_URL = "https://apps.alsoenergy.com";
const LOGIN_URL = `${POWERTRACK_URL}/Account/Login`;
const API_LAST_CHANGED = "1900-01-01T00:00:00.000Z";
const USERNAME_SELECTORS =
  'input[name="username"], input#username, input[name="Username"], input#Username, input[type="email"]';
const PASSWORD_SELECTORS =
  'input[type="password"], input[name="password"], input[name="Password"], input#Password';
const SUBMIT_SELECTORS =
  'button[type="submit"], input[type="submit"], button:has-text("Continue"), button:has-text("Log in"), button:has-text("Sign in")';

interface SiteInput {
  siteKey: string;
  siteName?: string;
}

interface SiteHardwareResponse {
  hardware?: Array<{
    key?: string | null;
    name?: string | null;
    functionCode?: number | null;
    archiveColumns?: string[] | null;
  }>;
}

interface ProductionResponse {
  yesterday?: number;
  today?: number;
  energyThirtyDays?: number;
  name?: string;
}

interface ChartResponse {
  namedResults?: Record<string, unknown>;
  series?: Array<{
    name?: string | null;
    customUnit?: string | null;
    units?: number | null;
    dataBinned?: Array<number | null>;
  }>;
}

async function main() {
  const username = process.env.ALSOENERGY_TEST_USERNAME;
  const password = process.env.ALSOENERGY_TEST_PASSWORD;

  if (!username || !password) {
    throw new Error("Missing ALSOENERGY_TEST credentials in process.env");
  }

  const requestedSites = process.argv.slice(2);
  const sites: SiteInput[] = requestedSites.length > 0
    ? requestedSites.map((siteKey) => ({ siteKey }))
    : [
        { siteKey: "S41121", siteName: "LaGrange Park Center" },
        { siteKey: "S40898", siteName: "Nazareth Center" },
        { siteKey: "S40919", siteName: "Wichita" },
      ];

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1600, height: 1200 },
    });
    const page = await context.newPage();
    await login(page, username, password);

    const end = new Date();
    end.setDate(end.getDate() - 1);
    const start30 = new Date(end);
    start30.setDate(start30.getDate() - 29);
    const start7 = new Date(end);
    start7.setDate(start7.getDate() - 6);

    const results = [];
    for (const site of sites) {
      const production = await fetchPowerTrackJson<ProductionResponse>(page, `/api/production/${site.siteKey}`);
      const hardware = await fetchPowerTrackJson<SiteHardwareResponse>(page, "/api/view/sitehardware", {
        method: "POST",
        body: {
          key: site.siteKey,
          includeRegistersFromHardware: [],
        },
      });

      const productionMeters = (hardware.hardware ?? []).filter((item) =>
        item.key &&
        item.functionCode === 2
      );

      const meterKeys = productionMeters.map((item) => item.key!) ;
      const chart7 = meterKeys.length > 0
        ? await fetchPowerTrackJson<ChartResponse>(page, "/api/view/chart", {
            method: "POST",
            body: {
              chartType: 15,
              binSize: 15,
              context: "site",
              start: formatLocalDate(start7),
              end: formatLocalDate(end),
              futureDays: 0,
              hardwareSet: meterKeys,
              sectionCode: 2,
              query: null,
              source: [site.siteKey],
            },
          })
        : null;

      const chart30 = meterKeys.length > 0
        ? await fetchPowerTrackJson<ChartResponse>(page, "/api/view/chart", {
            method: "POST",
            body: {
              chartType: 15,
              binSize: 15,
              context: "site",
              start: formatLocalDate(start30),
              end: formatLocalDate(end),
              futureDays: 0,
              hardwareSet: meterKeys,
              sectionCode: 2,
              query: null,
              source: [site.siteKey],
            },
          })
        : null;

      results.push({
        siteKey: site.siteKey,
        requestedName: site.siteName ?? null,
        portalName: production.name ?? null,
        productionMeters: productionMeters.map((item) => ({
          key: item.key,
          name: item.name,
          archiveColumns: item.archiveColumns ?? [],
        })),
        portalSummary: {
          today: production.today ?? null,
          yesterday: production.yesterday ?? null,
          energyThirtyDays: production.energyThirtyDays ?? null,
        },
        chart15: {
          sevenDayProduction: chart7?.namedResults?.production ?? null,
          thirtyDayProduction: chart30?.namedResults?.production ?? null,
          sevenDayBins: chart7?.series?.[0]?.dataBinned?.length ?? 0,
          thirtyDayBins: chart30?.series?.[0]?.dataBinned?.length ?? 0,
          sevenDayIntegratedKwh: integratePowerChartKwh(chart7),
          thirtyDayIntegratedKwh: integratePowerChartKwh(chart30),
          sevenDaySeries: summarizeSeries(chart7),
          thirtyDaySeries: summarizeSeries(chart30),
        },
      });
    }

    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
}

async function fetchPowerTrackJson<T>(
  page: Page,
  path: string,
  options?: {
    method?: "GET" | "POST";
    body?: unknown;
  }
): Promise<T> {
  const method = options?.method ?? "GET";
  const body = options?.body ? JSON.stringify(options.body) : null;

  const result = await page.evaluate(
    async ({ path, method, body, lastChanged }) => {
      const response = await fetch(`${path}?lastChanged=${encodeURIComponent(lastChanged)}`, {
        method,
        headers: body
          ? {
              "Content-Type": "application/json",
            }
          : undefined,
        body,
        credentials: "include",
      });

      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        text,
      };
    },
    {
      path,
      method,
      body,
      lastChanged: API_LAST_CHANGED,
    }
  );

  if (!result.ok) {
    throw new Error(`PowerTrack request failed (${result.status}) for ${path}: ${result.text.slice(0, 400)}`);
  }

  return JSON.parse(result.text) as T;
}

async function login(page: Page, username: string, password: string) {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  await page.waitForSelector(USERNAME_SELECTORS, { timeout: 20000, state: "visible" });
  await page.locator(USERNAME_SELECTORS).first().fill(username);

  const passwordAlreadyVisible = await isSelectorVisible(page, PASSWORD_SELECTORS);
  if (!passwordAlreadyVisible) {
    await clickSubmit(page);
    await page.waitForSelector(PASSWORD_SELECTORS, { timeout: 15000, state: "visible" });
  }

  await page.locator(PASSWORD_SELECTORS).first().fill(password);
  await clickSubmit(page);
  await page.waitForURL((url) => /apps\.alsoenergy\.com\/powertrack/i.test(url.toString()), {
    timeout: 30000,
  });
}

async function isSelectorVisible(page: Page, selector: string) {
  try {
    return await page.locator(selector).first().isVisible();
  } catch {
    return false;
  }
}

async function clickSubmit(page: Page) {
  const submitControl = page.locator(SUBMIT_SELECTORS).first();

  if (await submitControl.isVisible().catch(() => false)) {
    await submitControl.click();
    return;
  }

  if (await isSelectorVisible(page, PASSWORD_SELECTORS)) {
    await page.locator(PASSWORD_SELECTORS).first().press("Enter");
    return;
  }

  throw new Error("Could not find submit button on login page");
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function integratePowerChartKwh(chart: ChartResponse | null): number {
  return (chart?.series ?? [])
    .filter((series) =>
      Array.isArray(series.dataBinned) &&
      series.dataBinned.length > 0 &&
      !isEstimateSeries(series) &&
      (
        (series.customUnit ?? "").toLowerCase().includes("kilowatt") ||
        series.units === 10 ||
        series.units === 11
      )
    )
    .reduce((chartTotal, series) => {
      const seriesTotal = (series.dataBinned ?? []).reduce((sum, value) => {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          return sum;
        }

        return sum + Math.max(0, value);
      }, 0);

      const unitLabel = (series.customUnit ?? "").toLowerCase();
      const seriesTotalKwh =
        unitLabel.includes("kilowatt hours") || series.units === 11
          ? seriesTotal
          : seriesTotal * 0.25;

      return chartTotal + seriesTotalKwh;
    }, 0);
}

function summarizeSeries(chart: ChartResponse | null) {
  return (chart?.series ?? []).map((series) => ({
    name: series.name ?? null,
    customUnit: series.customUnit ?? null,
    units: series.units ?? null,
    bins: series.dataBinned?.length ?? 0,
    isEstimate: isEstimateSeries(series),
    integratedKwh: (() => {
      const rawTotal = (series.dataBinned ?? []).reduce((sum, value) => {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          return sum;
        }

        return sum + Math.max(0, value);
      }, 0);

      const unitLabel = (series.customUnit ?? "").toLowerCase();
      return unitLabel.includes("kilowatt hours") || series.units === 11
        ? rawTotal
        : rawTotal * 0.25;
    })(),
  }));
}

function isEstimateSeries(series: { name?: string | null }) {
  return (series.name ?? "").toLowerCase().includes("estimate");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
