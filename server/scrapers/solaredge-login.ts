import type { Page, Response } from "playwright";

const MONITORING_ORIGIN = "https://monitoring.solaredge.com";
const USERNAME_SELECTOR = 'input[name="username"], input[name="j_username"], input[type="email"], input[autocomplete="username"], #username';
const PASSWORD_SELECTOR = 'input[name="password"], input[name="j_password"], input[type="password"], #password';

export async function loginSolarEdge(
  page: Page,
  username: string,
  password: string,
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());
  let phase = "opening the login page";
  let navigationStatus: number | undefined;
  const recordNavigation = (response: Response) => {
    if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
      navigationStatus = response.status();
    }
  };
  page.on("response", recordNavigation);

  try {
    console.log("[SolarEdge Browser] Navigating to login page...");
    await page.goto(`${MONITORING_ORIGIN}/solaredge-web/p/login`, {
      waitUntil: "domcontentloaded",
      timeout: remaining(),
    });

    const visibleUsername = page.locator(USERNAME_SELECTOR).filter({ visible: true }).first();
    const visiblePassword = page.locator(PASSWORD_SELECTOR).filter({ visible: true }).first();
    const welcomeLogin = page.getByRole("button", { name: /^log\s*in$/i })
      .or(page.getByRole("link", { name: /^log\s*in$/i }))
      .filter({ visible: true }).first();

    phase = "waiting for the welcome page or credential form";
    // The welcome screen may render after navigation is complete. Keep waiting
    // for either state instead of checking the button count once and missing it.
    await visibleUsername.or(welcomeLogin).first().waitFor({
      state: "visible",
      timeout: remaining(),
    });
    if (!(await visibleUsername.isVisible())) {
      phase = "opening the credential form";
      console.log("[SolarEdge Browser] Opening the current login form...");
      await welcomeLogin.click({ timeout: remaining() });
    }

    phase = "waiting for visible credential fields";
    await visiblePassword.waitFor({ state: "visible", timeout: remaining() });

    // The current sign-in page also contains a corporate SSO email form. Prefer
    // the form containing the password, and ignore hidden legacy inputs.
    const credentialForm = page.locator("form").filter({ has: visiblePassword }).first();
    const hasForm = await credentialForm.isVisible();
    const usernameField = hasForm
      ? credentialForm.locator(USERNAME_SELECTOR).filter({ visible: true }).first()
      : visibleUsername;
    await usernameField.waitFor({ state: "visible", timeout: remaining() });

    phase = "entering credentials";
    await usernameField.fill(username, { timeout: remaining() });
    await visiblePassword.fill(password, { timeout: remaining() });

    phase = "submitting the credential form";
    const submitRoot = hasForm ? credentialForm : page;
    const submitButton = submitRoot.getByRole("button", { name: /^(?:sign\s*in|log\s*in)$/i })
      .or(submitRoot.locator('button[type="submit"], input[type="submit"], [data-testid="login-button"], .login-button'))
      .filter({ visible: true }).first();
    if (await submitButton.isVisible()) {
      await submitButton.click({ timeout: remaining() });
    } else {
      await visiblePassword.press("Enter", { timeout: remaining() });
    }

    phase = "waiting for the authenticated dashboard";
    // Match the actual destination, never the hostname or a redirect_uri query
    // parameter on the sign-in page. Those also contain "monitoring".
    await page.waitForURL(isSolarEdgeDashboard, {
      waitUntil: "domcontentloaded",
      timeout: remaining(),
    });
    console.log("[SolarEdge Browser] Login successful");
  } catch (error) {
    // Do not include raw Playwright errors, page text, or OAuth query strings:
    // a failed fill operation can contain the supplied credential value.
    let location = "unavailable";
    try {
      const url = new URL(page.url());
      location = `${url.origin}${url.pathname}`;
    } catch {
      // A closed page may not have a usable URL.
    }
    const kind = error instanceof Error ? error.name : "Error";
    throw new Error(
      `SolarEdge login failed while ${phase} (${kind}; page: ${location}; HTTP: ${navigationStatus ?? "unavailable"}).`,
    );
  } finally {
    page.off("response", recordNavigation);
  }
}

function isSolarEdgeDashboard(url: URL): boolean {
  if (url.origin !== MONITORING_ORIGIN) {
    return false;
  }
  return /^\/solaredge-web\/p\/site(?:\/|$)/.test(url.pathname)
    || (/^\/one\/?$/.test(url.pathname)
      && /^#\/(?:site-list|(?:residential\/)?dashboard)(?:[/?]|$)/.test(url.hash));
}
