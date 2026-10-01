// Client delivery timing, never server handler timing. Fetch does not expose DNS,
// TCP, TLS, pool queueing or proxy upstream spans; do not infer them from these.
export function deliveryContext(env = process.env) {
  return {
    runtime: typeof Bun === "undefined" ? "node" : "bun",
    proxySettingsPresent: ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]
      .some((name) => Boolean(env[name])),
    proxyBypassSettingsPresent: ["NO_PROXY", "no_proxy"].some((name) => Boolean(env[name])),
    measurementBoundary: "client-fetch-through-json-parse",
    proxyUsage: "not-observable-from-fetch",
    upstreamPhases: "not-observable-from-fetch"
  };
}

export async function timedJsonRequest(url, timeoutMs, fetchRequest = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let status = null;
  let responseReadyMs = null;
  let bodyReadMs = null;
  let bytes = null;
  try {
    const response = await fetchRequest(url, {
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    status = response.status;
    responseReadyMs = performance.now() - started;
    const text = await response.text();
    bodyReadMs = performance.now() - started - responseReadyMs;
    bytes = Buffer.byteLength(text);
    const body = JSON.parse(text);
    return {
      ...timing(), ok: response.ok, body,
      error: body?.error ?? undefined, timedOut: false
    };
  } catch (error) {
    return {
      ...timing(), ok: false, body: null,
      error: error instanceof Error ? error.message : String(error),
      timedOut: controller.signal.aborted
    };
  } finally {
    clearTimeout(timeout);
  }

  function timing() {
    return {
      startedAt, status, ms: Math.round(performance.now() - started),
      responseReadyMs: round(responseReadyMs), bodyReadMs: round(bodyReadMs), bytes
    };
  }
}

function round(value) {
  return value === null ? null : Math.round(value * 100) / 100;
}

// Explicit allowlist: never spread response bodies or arbitrary response headers
// into persisted diagnostics. Keep failures and incomplete timings visible.
export function deliverySample(sample) {
  return Object.fromEntries([
    "endpoint", "startedAt", "status", "ms", "responseReadyMs", "bodyReadMs", "bytes", "timedOut", "error"
  ].filter((key) => sample[key] !== undefined).map((key) => [key, sample[key]]));
}
