import type { Page, Request } from "playwright";

// Never retain paths, query strings, headers or response bodies: these may
// contain system identifiers, credentials or OAuth tokens.
export function trackSmaNetwork(page: Page) {
  const pending = new Map<Request, { started: number; destination: string; type: string }>();
  const failures: Record<string, number> = {};
  const httpErrors: Record<string, number> = {};
  let failedRequests = 0;
  let completedRequests = 0;
  let pageErrors = 0;
  const onRequest = (request: Request) => {
    const hostname = new URL(request.url()).hostname;
    const destination = hostname === "ennexos.sunnyportal.com" ? "portal"
      : hostname === "login.sma.energy" ? "login"
      : hostname.endsWith(".sma.energy") || hostname.endsWith(".sunnyportal.com") ? "sma-service"
      : "other";
    pending.set(request, { started: Date.now(), destination, type: request.resourceType() });
  };
  const onFinished = (request: Request) => { pending.delete(request); completedRequests++; };
  const onFailed = (request: Request) => {
    pending.delete(request);
    failedRequests++;
    const raw = request.failure()?.errorText || "";
    const kind = /^net::ERR_[A-Z_]+$/.test(raw) ? raw : "other";
    failures[kind] = (failures[kind] || 0) + 1;
  };
  const onResponse = (response: import("playwright").Response) => {
    if (response.status() >= 400) {
      const key = String(response.status());
      httpErrors[key] = (httpErrors[key] || 0) + 1;
    }
  };
  const onError = () => { pageErrors++; };
  page.on("request", onRequest);
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed);
  page.on("response", onResponse);
  page.on("pageerror", onError);
  return {
    snapshot: () => ({
      failedRequests, completedRequests, pageErrors, httpErrors: { ...httpErrors }, failureKinds: { ...failures },
      pendingCount: pending.size,
      pending: Array.from(pending.values()).sort((a, b) => a.started - b.started).slice(0, 12)
        .map(({ started, ...request }) => ({ ...request, ageSeconds: Math.floor((Date.now() - started) / 1000) })),
    }),
    dispose: () => {
      page.off("request", onRequest);
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFailed);
      page.off("response", onResponse);
      page.off("pageerror", onError);
      pending.clear();
    },
  };
}
