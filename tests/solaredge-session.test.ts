import test from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright";
import { solarEdgeSessionRequest } from "../server/scrapers/solaredge-session";

const origin = "https://monitoring.solaredge.com";
function fixture({ legacy = false, ready = true, fail = false } = {}) {
  let token: string | null = legacy ? null : "private-fixture-token";
  const calls: Array<{ url: string; options: any }> = [];
  const request = async (url: string, options: any) => {
    calls.push({ url, options });
    if (fail) throw new Error(`Request headers: ${options.headers.Authorization}`);
    return { status: () => options.headers.Authorization || legacy ? 200 : 401 };
  };
  const page = {
    url: () => origin + (legacy ? "/solaredge-web/p/site/123" : "/one#/site-list"),
    waitForFunction: async () => { if (!ready) throw new Error("timeout"); },
    evaluate: async () => token,
    context: () => ({ request: { get: request, post: request } }),
  } as unknown as Page;
  return { page, calls, setToken: (value: string | null) => { token = value; } };
}

test("search and measurement requests carry the current dashboard bearer token", async () => {
  const f = fixture();
  const request = await solarEdgeSessionRequest(f.page);
  assert.equal((await request.post(origin + "/services/sitelist/searchSites", {
    data: { pageRequest: { pageNum: 1 } }, headers: { Accept: "application/json" },
  })).status(), 200);
  f.setToken("refreshed-fixture-token");
  assert.equal((await request.get(origin + "/services/dashboard/energy/sites/123")).status(), 200);
  assert.equal(f.calls[0].options.headers.Authorization, "Bearer private-fixture-token");
  assert.equal(f.calls[0].options.headers.Accept, "application/json");
  assert.equal(f.calls[0].options.data.pageRequest.pageNum, 1);
  assert.equal(f.calls[1].options.headers.Authorization, "Bearer refreshed-fixture-token");
  assert.ok(f.calls.every(call => call.options.maxRedirects === 0));
});

test("does not send session tokens to other origins or non-service paths", async () => {
  const f = fixture();
  const request = await solarEdgeSessionRequest(f.page);
  for (const url of ["https://example.invalid/services/search", origin + "/one", "https://user@monitoring.solaredge.com/services/search"]) {
    await assert.rejects(request.get(url), /must target monitoring services/);
  }
  assert.equal(f.calls.length, 0);
});

test("missing or lost modern session tokens fail before an API request", async () => {
  await assert.rejects(solarEdgeSessionRequest(fixture({ ready: false }).page), /not available after login/);
  const f = fixture();
  const request = await solarEdgeSessionRequest(f.page);
  f.setToken(null);
  await assert.rejects(request.get(origin + "/services/test"), /no longer available/);
  assert.equal(f.calls.length, 0);
});

test("legacy dashboards can still use their cookie session", async () => {
  const f = fixture({ legacy: true });
  const request = await solarEdgeSessionRequest(f.page);
  assert.equal((await request.get(origin + "/services/test")).status(), 200);
  assert.equal(f.calls[0].options.headers.Authorization, undefined);
});

test("transport errors cannot expose bearer tokens in sync logs", async () => {
  const f = fixture({ fail: true });
  const request = await solarEdgeSessionRequest(f.page);
  await assert.rejects(request.get(origin + "/services/test"), (error: Error) => {
    assert.match(error.message, /failed before a response/);
    assert.doesNotMatch(error.message, /private-fixture-token|Authorization/);
    assert.equal(error.cause, undefined);
    return true;
  });
});
