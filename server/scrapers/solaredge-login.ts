import type { Page, Request, Response } from "playwright";

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
  const authPosts: Array<{ status: number; code?: string }> = [];
  let failedAuthRequests = 0;
  const isAuthPost = (request: Request) => {
    const url = new URL(request.url());
    return url.origin === "https://login.solaredge.com" && request.method() === "POST";
  };
  const recordFailedRequest = (request: Request) => {
    if (isAuthPost(request)) failedAuthRequests += 1;
  };
  const recordNavigation = (response: Response) => {
    if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
      navigationStatus = response.status();
    }
    if (isAuthPost(response.request()) && authPosts.length < 16) {
      const entry: { status: number; code?: string } = { status: response.status() };
      authPosts.push(entry);
      // Keep only recognized error identifiers, never raw provider responses,
      // tokens, endpoint paths, request bodies, or credential values.
      if (response.status() >= 400 && response.headers()["content-type"]?.includes("application/json")) {
        void response.json().then((body: unknown) => {
          if (!body || typeof body !== "object") return;
          const fields = body as Record<string, unknown>;
          for (const value of [fields.error, fields.code, fields.errorCode]) {
            if (typeof value === "string" && SAFE_AUTH_CODES.has(value)) {
              entry.code = value;
              break;
            }
          }
        }).catch(() => { /* Diagnostics must never replace the login error. */ });
      }
    }
  };
  page.on("response", recordNavigation);
  page.on("requestfailed", recordFailedRequest);

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
    const signals = await loginPageSignals(page);
    throw new Error(
      `SolarEdge login failed while ${phase} (${kind}; page: ${location}; HTTP: ${navigationStatus ?? "unavailable"}). `
      + `Auth diagnostics: ${JSON.stringify({ authPosts, failedAuthRequests, signals })}`,
    );
  } finally {
    page.off("response", recordNavigation);
    page.off("requestfailed", recordFailedRequest);
  }
}

const SAFE_AUTH_CODES = new Set([
  "invalid_user_password", "invalid_grant", "access_denied", "unauthorized",
  "too_many_attempts", "too_many_requests", "blocked_user", "password_leaked",
  "mfa_required", "mfa_registration_required", "requires_verification", "invalid_captcha",
]);

async function loginPageSignals(page: Page): Promise<string[]> {
  try {
    // Classify visible text in memory. Raw text can contain credentials and
    // OAuth values, so only these fixed labels may leave this function.
    const text = await page.locator("body").innerText({ timeout: 500 });
    const patterns: Array<[string, RegExp]> = [
      ["invalid-credentials", /wrong email or password|invalid (?:email|username|password|credentials)|incorrect (?:email|username|password)|username or password is incorrect/i],
      ["account-blocked-or-rate-limited", /account (?:is |has been )?(?:blocked|locked)|too many (?:login|failed|attempts|requests)|suspicious (?:login|activity)/i],
      ["human-verification", /captcha|verify (?:that )?you are human|security challenge|checking your browser/i],
      ["mfa", /verification code|authentication code|one.time (?:code|password)|two.factor|multi.factor/i],
      ["password-reset-required", /reset your password|password (?:has )?expired|change your password/i],
      ["generic-provider-error", /something went wrong|unable to (?:log|sign) in|access denied|unauthorized|unexpected error/i],
    ];
    return patterns.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  } catch {
    return ["page-unavailable"];
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
