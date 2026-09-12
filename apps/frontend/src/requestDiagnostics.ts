// Never log query strings, wallet addresses, invitation codes, bodies or headers.
const routeSegments = new Set("assets wallet planet moon player alliance infrastructure shipyard defenses research resources queues supply-sources missions fleet-visibility transactions status attack-protection system galaxy overview settlement planets highscores watched-planets og api".split(" "));

export function diagnosticRoute(url: string): string {
  try {
    return new URL(url, "https://local.invalid").pathname.split("/").map(part =>
      !part || routeSegments.has(part) ? part : ":id",
    ).join("/");
  } catch { return ":invalid-url"; }
}

/** Observes handler latency, not socket transfer time. A pending handler is logged before Bun's idle deadline. */
export async function observeFrontendRequest(request: Request, handle: () => Promise<Response>, deadlineMs = 9_000): Promise<Response> {
  const started = performance.now();
  const requestId = crypto.randomUUID();
  const log = (outcome: string, response?: Response) => console.warn(JSON.stringify({
    event: "frontend_request", requestId, route: diagnosticRoute(request.url), method: request.method,
    durationMs: Math.round(performance.now() - started), outcome,
    ...(response ? { status: response.status, animationCache: response.headers.get("x-veydrift-animation-cache") } : {}),
  }));
  const timer = setTimeout(() => log("handler_pending"), deadlineMs);
  const aborted = () => log("client_disconnected");
  request.signal.addEventListener("abort", aborted, { once: true });
  try {
    const response = await handle();
    if (performance.now() - started >= 300 || response.status >= 400) log("response", response);
    return response;
  } catch (error) {
    log("handler_error");
    throw error;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", aborted);
  }
}
