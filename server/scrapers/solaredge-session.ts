import type { APIRequestContext, Page } from "playwright";

const ORIGIN = "https://monitoring.solaredge.com";
export type SolarEdgeRequest = Pick<APIRequestContext, "get" | "post">;

// APIRequestContext shares cookies with the browser, but does not run the
// dashboard's interceptor that adds se_access_token from localStorage.
export async function solarEdgeSessionRequest(page: Page): Promise<SolarEdgeRequest> {
  const current = new URL(page.url());
  if (current.origin !== ORIGIN) {
    throw new Error("SolarEdge API session requires the monitoring dashboard.");
  }
  const modernDashboard = /^\/one\/?$/.test(current.pathname);
  if (modernDashboard) {
    try {
      await page.waitForFunction(() => Boolean(localStorage.getItem("se_access_token")),
        undefined, { timeout: 15_000 });
    } catch {
      throw new Error("SolarEdge dashboard access token was not available after login.");
    }
  }

  const send = async (method: "get" | "post", url: string, options?: Parameters<APIRequestContext["get"]>[1]) => {
    const target = new URL(url);
    if (target.origin !== ORIGIN || !target.pathname.startsWith("/services/") || target.username || target.password) {
      throw new Error("SolarEdge session requests must target monitoring services.");
    }
    // Read each time so a token refreshed by the dashboard is not cached here.
    const token = await page.evaluate((origin) => {
      if (location.origin !== origin) return null;
      return localStorage.getItem("se_access_token");
    }, ORIGIN);
    if (modernDashboard && !token) {
      throw new Error("SolarEdge dashboard access token is no longer available.");
    }
    try {
      return await page.context().request[method](url, {
        ...options,
        headers: { ...options?.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        // Never forward the bearer token through a provider redirect.
        maxRedirects: 0,
      });
    } catch {
      // Playwright request errors can include request headers. Do not log them.
      throw new Error("SolarEdge dashboard API request failed before a response was received.");
    }
  };
  return { get: (url, options) => send("get", url, options), post: (url, options) => send("post", url, options) };
}
