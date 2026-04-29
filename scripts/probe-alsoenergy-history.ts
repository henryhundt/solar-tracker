import { chromium, type Page } from "playwright";

const POWERTRACK_URL = "https://apps.alsoenergy.com";
const LOGIN_URL = `${POWERTRACK_URL}/Account/Login`;
const USERNAME_SELECTORS =
  'input[name="username"], input#username, input[name="Username"], input#Username, input[type="email"]';
const PASSWORD_SELECTORS =
  'input[type="password"], input[name="password"], input[name="Password"], input#Password';
const SUBMIT_SELECTORS =
  'button[type="submit"], input[type="submit"], button:has-text("Continue"), button:has-text("Log in"), button:has-text("Sign in")';

async function main() {
  const username = process.env.ALSOENERGY_TEST_USERNAME;
  const password = process.env.ALSOENERGY_TEST_PASSWORD;
  const siteKey = process.argv[2] ?? "S41121";

  if (!username || !password) {
    throw new Error("Missing ALSOENERGY_TEST credentials in process.env");
  }

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
    await page.goto(`${POWERTRACK_URL}/powertrack/${siteKey}/overview/dashboard`, {
      waitUntil: "load",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    const today = new Date().toISOString().slice(0, 10);
    const probes = [
      {
        label: "chart255_recent_30d",
        payload: {
          binSize: null,
          context: "site",
          start: "2026-03-15",
          end: today,
          sectionCode: -1,
          query: null,
          chartType: 255,
          source: [siteKey],
        },
      },
      {
        label: "chart255_year",
        payload: {
          binSize: null,
          context: "site",
          start: "2025-04-01",
          end: today,
          sectionCode: -1,
          query: null,
          chartType: 255,
          source: [siteKey],
        },
      },
      {
        label: "chart255_lifetime",
        payload: {
          binSize: null,
          context: "site",
          start: "2018-03-08",
          end: today,
          sectionCode: -1,
          query: null,
          chartType: 255,
          source: [siteKey],
        },
      },
      {
        label: "chart172_15min_3d",
        payload: {
          chartType: 172,
          binSize: 15,
          context: "site",
          start: "2026-04-11",
          end: today,
          futureDays: 0,
          hardwareSet: ["H124225", "H124226", "H124227", "H124228"],
          sectionCode: 2,
          source: [siteKey],
        },
      },
      {
        label: "chart172_15min_30d",
        payload: {
          chartType: 172,
          binSize: 15,
          context: "site",
          start: "2026-03-15",
          end: today,
          futureDays: 0,
          hardwareSet: ["H124225", "H124226", "H124227", "H124228"],
          sectionCode: 2,
          source: [siteKey],
        },
      },
      {
        label: "chart172_15min_year",
        payload: {
          chartType: 172,
          binSize: 15,
          context: "site",
          start: "2025-04-01",
          end: today,
          futureDays: 0,
          hardwareSet: ["H124225", "H124226", "H124227", "H124228"],
          sectionCode: 2,
          source: [siteKey],
        },
      },
      {
        label: "chart172_15min_lifetime",
        payload: {
          chartType: 172,
          binSize: 15,
          context: "site",
          start: "2018-03-08",
          end: today,
          futureDays: 0,
          hardwareSet: ["H124225", "H124226", "H124227", "H124228"],
          sectionCode: 2,
          source: [siteKey],
        },
      },
    ];

    const results = [];
    for (const probe of probes) {
      const json = await fetchChart(page, probe.payload);
      results.push({
        label: probe.label,
        summary: summarizeChartResponse(json),
      });
    }

    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
}

async function fetchChart(page: Page, payload: Record<string, unknown>) {
  return await page.evaluate(async ({ payload }) => {
    const response = await fetch("/api/view/chart?lastChanged=1900-01-01T00:00:00.000Z", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      credentials: "include",
    });

    const text = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      body: text,
    };
  }, { payload });
}

function summarizeChartResponse(result: { status: number; ok: boolean; body: string }) {
  const summary: Record<string, unknown> = {
    status: result.status,
    ok: result.ok,
  };

  try {
    const json = JSON.parse(result.body);
    summary.lastChanged = json.lastChanged ?? null;
    summary.hasAlertMessages = json.hasAlertMessages ?? null;
    summary.allowSmallBinSize = json.allowSmallBinSize ?? null;
    summary.lastDataDatetime = json.lastDataDatetime ?? null;
    summary.namedResults = json.namedResults ?? null;
    summary.seriesCount = Array.isArray(json.series) ? json.series.length : 0;
    summary.series = Array.isArray(json.series)
      ? json.series.map((series: any) => summarizeSeries(series))
      : [];
    summary.message = json.message ?? null;
    return summary;
  } catch {
    summary.bodyPreview = result.body.slice(0, 1000);
    return summary;
  }
}

function summarizeSeries(series: any) {
  const candidateArrays = [
    Array.isArray(series?.dataXy) ? series.dataXy : null,
    Array.isArray(series?.dataBinned) ? series.dataBinned : null,
    Array.isArray(series?.data) ? series.data : null,
    Array.isArray(series?.points) ? series.points : null,
    Array.isArray(series?.values) ? series.values : null,
    Array.isArray(series?.items) ? series.items : null,
  ].filter((value): value is unknown[] => Array.isArray(value));

  const candidateArray =
    candidateArrays.find((value) => value.length > 0) ??
    candidateArrays[0] ??
    [];

  return {
    name: series?.name ?? null,
    customUnit: series?.customUnit ?? null,
    color: series?.color ?? null,
    keys: Object.keys(series ?? {}).slice(0, 20),
    pointCount: candidateArray.length,
    firstPoint: candidateArray[0] ?? null,
    lastPoint: candidateArray.at(-1) ?? null,
    preview: JSON.stringify(series).slice(0, 500),
  };
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
