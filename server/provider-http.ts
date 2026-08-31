const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;
const MIN_PROVIDER_TIMEOUT_MS = 1_000;
const MAX_PROVIDER_TIMEOUT_MS = 5 * 60 * 1000;

export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = getProviderTimeoutMs(),
): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);

  if (upstreamSignal?.aborted) {
    abortFromUpstream();
  } else {
    upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
  }

  const timeout = setTimeout(() => {
    controller.abort(new Error(`Provider request timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  timeout.unref();

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && !upstreamSignal?.aborted) {
      throw new Error(`Provider request timed out after ${timeoutMs}ms`, { cause: error });
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

function getProviderTimeoutMs(): number {
  const configured = Number(process.env.PROVIDER_HTTP_TIMEOUT_MS);
  if (!Number.isFinite(configured)) {
    return DEFAULT_PROVIDER_TIMEOUT_MS;
  }

  return Math.max(MIN_PROVIDER_TIMEOUT_MS, Math.min(configured, MAX_PROVIDER_TIMEOUT_MS));
}
