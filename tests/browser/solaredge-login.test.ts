import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { loginSolarEdge } from "../../server/scrapers/solaredge-login";

const MONITORING = "https://monitoring.solaredge.com";
const LOGIN = "https://login.solaredge.com/login?redirect_uri=https%3A%2F%2Fmonitoring.solaredge.com%2Fmfe%2Fauth%2Fcallback&code=private-oauth-code";
const USERNAME = "fixture-user@example.invalid";
const PASSWORD = "fixture-password-never-log";
let browser: Browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

interface Fixture {
  start: string;
  welcome?: string;
  signIn?: string;
  status?: number;
}

async function withFixture(fixture: Fixture, run: (page: Page) => Promise<void>): Promise<void> {
  const context = await browser.newContext();
  // Fulfill or abort EVERY request: these tests never contact SolarEdge or use
  // real credentials, despite exercising its redirect origins and paths.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const bodies: Record<string, string | undefined> = {
      [`${MONITORING}/solaredge-web/p/login`]: fixture.start,
      [`${MONITORING}/mfe/auth/`]: fixture.welcome,
      "https://login.solaredge.com/login": fixture.signIn,
      [`${MONITORING}/mfe/auth/callback`]: `<script>setTimeout(() => location.href = '/one#/site-list', 250)</script>`,
      [`${MONITORING}/one`]: "<h1>Site list</h1>",
      [`${MONITORING}/solaredge-web/p/site/123`]: "<h1>Legacy dashboard</h1>",
      [`${MONITORING}/poll`]: "ok",
    };
    const body = bodies[`${url.origin}${url.pathname}`];
    if (body === undefined) {
      await route.abort();
      return;
    }
    await route.fulfill({ status: fixture.status ?? 200, contentType: "text/html", body });
  });
  try {
    await run(await context.newPage());
  } finally {
    await context.close();
  }
}

function credentialForm({ reject = false, hidden = false, legacy = false, submitButton = true } = {}): string {
  const destination = legacy
    ? `${MONITORING}/solaredge-web/p/site/123`
    : `${MONITORING}/mfe/auth/callback?code=private-oauth-code`;
  return `
    <form id="credentials" ${hidden ? 'style="display:none"' : ""}>
      <label>Email address<input name="${legacy ? "j_username" : "username"}" type="${legacy ? "text" : "email"}"></label>
      <label>Password<input name="${legacy ? "j_password" : "password"}" type="password"></label>
      ${submitButton ? '<button type="submit">Sign in</button>' : ""}
    </form>
    <script>
      const form = document.getElementById('credentials');
      ${!submitButton ? "form.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); form.requestSubmit(); } };" : ""}
      form.onsubmit = (event) => {
        event.preventDefault();
        const values = Array.from(form.querySelectorAll('input')).map(input => input.value);
        if (values[0] !== ${JSON.stringify(USERNAME)} || values[1] !== ${JSON.stringify(PASSWORD)}) {
          throw new Error('Fixture received incorrect credentials');
        }
        ${reject
          ? `document.body.insertAdjacentHTML('beforeend', '<div role="alert">Rejected ${USERNAME} ${PASSWORD}</div>');`
          : `setTimeout(() => location.href = ${JSON.stringify(destination)}, 250);`}
      };
      ${hidden ? "setTimeout(() => form.style.display = 'block', 600);" : ""}
    </script>`;
}

test("waits for a delayed welcome button, redirect, and visible password form", async () => {
  await withFixture({
    start: `<script>setTimeout(() => location.href = '/mfe/auth/', 50)</script>`,
    welcome: `<script>
      setTimeout(() => {
        const button = document.createElement('button');
        button.textContent = 'Log in';
        button.onclick = () => location.href = ${JSON.stringify(LOGIN)};
        document.body.append(button);
      }, 800);
    </script>`,
    signIn: `
      <input name="username" style="display:none"><input type="password" style="display:none">
      <form><input type="email" aria-label="Corporate email"><button>Sign in</button></form>
      ${credentialForm({ hidden: true })}`,
  }, async (page) => {
    await loginSolarEdge(page, USERNAME, PASSWORD, { timeoutMs: 8000 });
    assert.equal(page.url(), `${MONITORING}/one#/site-list`);
    assert.equal(page.listenerCount("response"), 0);
  });
});

test("does not wait for network idle while the welcome page polls in the background", async () => {
  await withFixture({
    start: `<button onclick='location.href = ${JSON.stringify(LOGIN)}'>Log in</button>
      <script>setInterval(() => fetch('/poll').catch(() => {}), 100)</script>`,
    signIn: credentialForm(),
  }, async (page) => {
    await loginSolarEdge(page, USERNAME, PASSWORD, { timeoutMs: 5000 });
    assert.equal(page.url(), `${MONITORING}/one#/site-list`);
  });
});

test("supports a direct legacy credential form", async () => {
  await withFixture({ start: credentialForm({ legacy: true }) }, async (page) => {
    await loginSolarEdge(page, USERNAME, PASSWORD, { timeoutMs: 5000 });
    assert.equal(page.url(), `${MONITORING}/solaredge-web/p/site/123`);
  });
});

test("submits with Enter when the form has no submit button", async () => {
  await withFixture({ start: credentialForm({ submitButton: false }) }, async (page) => {
    await loginSolarEdge(page, USERNAME, PASSWORD, { timeoutMs: 5000 });
    assert.equal(page.url(), `${MONITORING}/one#/site-list`);
  });
});

for (const variant of ["monitoring login page", "OAuth sign-in page"] as const) {
  test(`does not report a rejected login as success on the ${variant}`, async () => {
    const signIn = credentialForm({ reject: true });
    await withFixture({
      start: variant === "monitoring login page"
        ? signIn
        : `<script>location.href = ${JSON.stringify(LOGIN)}</script>`,
      signIn,
    }, async (page) => {
      await assert.rejects(loginSolarEdge(page, USERNAME, PASSWORD, { timeoutMs: 1800 }), (error: Error) => {
        assert.match(error.message, /waiting for the authenticated dashboard/);
        assert.match(error.message, /HTTP: 200/);
        assert.doesNotMatch(error.message, /fixture-user|fixture-password|private-oauth-code|redirect_uri/);
        return true;
      });
      assert.equal(page.listenerCount("response"), 0);
    });
  });
}

test("reports the login stage and HTTP status when the provider page is unavailable", async () => {
  await withFixture({ start: "<h1>Service unavailable</h1>", status: 503 }, async (page) => {
    await assert.rejects(loginSolarEdge(page, USERNAME, PASSWORD, { timeoutMs: 1000 }), {
      message: /waiting for the welcome page or credential form.*HTTP: 503/,
    });
    assert.equal(page.listenerCount("response"), 0);
  });
});

test("does not expose credentials from Playwright fill errors", async () => {
  await withFixture({ start: '<input type="email" disabled><input type="password">' }, async (page) => {
    await assert.rejects(loginSolarEdge(page, USERNAME, PASSWORD, { timeoutMs: 1000 }), (error: Error) => {
      assert.match(error.message, /entering credentials/);
      assert.doesNotMatch(error.message, /fixture-user|fixture-password/);
      assert.equal(error.cause, undefined);
      return true;
    });
  });
});
