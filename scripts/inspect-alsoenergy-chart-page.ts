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
  const targetPath = process.argv[2] ?? "/powertrack/H124226/analysis/chartbuilder?c=15";

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

    const captured: Array<{
      method: string;
      url: string;
      requestBody: string;
      status: number;
      preview: string;
    }> = [];

    page.on("response", async (response) => {
      const url = response.url();
      if (!/\/api\/view\/chart|\/api\/view\/|\/chartbuilder/i.test(url)) {
        return;
      }

      let preview = "";
      const contentType = response.headers()["content-type"] ?? "";
      if (/application\/json|text\/plain/i.test(contentType)) {
        try {
          preview = (await response.text()).slice(0, 1000);
        } catch {
          preview = "<body unavailable>";
        }
      }

      captured.push({
        method: response.request().method(),
        url,
        requestBody: response.request().postData()?.slice(0, 1000) ?? "",
        status: response.status(),
        preview,
      });
    });

    await login(page, username, password);
    await page.goto(new URL(targetPath, POWERTRACK_URL).toString(), {
      waitUntil: "load",
      timeout: 30000,
    });
    await page.waitForTimeout(6000);

    const pageInfo = await page.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      bodySnippet: document.body.innerText.slice(0, 3000),
    }));

    console.log(JSON.stringify({ targetPath, pageInfo, captured }, null, 2));
  } finally {
    await browser.close();
  }
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
