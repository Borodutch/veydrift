type ObservabilityLevel = "info" | "warn" | "error";

type BaseObservabilityEvent = {
  kind: string;
  component?: string;
  durationMs?: number;
  workerRole?: string;
  workerIndex?: string | null;
};

export type ApiRequestObservabilityEvent = {
  kind: "api_request";
  durationMs: number;
  error?: string;
  method: string;
  path: string;
  queryKeys: string[];
  route: string;
  status: number;
  stream: boolean;
  workerRole: string;
};

export function emitObservabilityEvent(
  event: BaseObservabilityEvent & Record<string, unknown>,
  level: ObservabilityLevel = "info"
): void {
  const line = JSON.stringify({
    schemaVersion: 1,
    service: process.env.VEYDRIFT_SERVICE_NAME ?? "veydrift",
    emittedAt: new Date().toISOString(),
    pid: typeof process !== "undefined" ? process.pid : null,
    workerIndex: process.env.VEYDRIFT_WORKER_INDEX ?? null,
    ...event
  });
  console[level](line);
}

export function apiRequestEvent(
  request: Request,
  url: URL,
  workerRole: string,
  status: number,
  durationMs: number,
  error?: string
): ApiRequestObservabilityEvent {
  const entry: ApiRequestObservabilityEvent = {
    kind: "api_request",
    durationMs: Math.round(durationMs),
    method: request.method,
    path: `${url.pathname}${url.search}`,
    queryKeys: [...url.searchParams.keys()].sort(),
    route: normalizedRoute(url.pathname),
    status,
    stream: url.pathname === "/chain/events",
    workerRole
  };
  if (error) entry.error = error;
  return entry;
}

export function logApiRequestEvent(
  request: Request,
  url: URL,
  workerRole: string,
  status: number,
  durationMs: number,
  error?: string
): void {
  const entry = apiRequestEvent(request, url, workerRole, status, durationMs, error);
  const level: ObservabilityLevel = status >= 500 || entry.durationMs >= 1_000 ? "warn" : "info";
  emitObservabilityEvent(entry, level);
}

export function normalizedRoute(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  const normalized = parts.map((part, index) => {
    const previous = parts[index - 1] ?? "";
    if (/^0x[a-fA-F0-9]{40}$/.test(part)) return ":wallet";
    if (/^0x[a-fA-F0-9]{64}$/.test(part)) return ":hash";
    if (/^\d+$/.test(part)) {
      if (previous === "mission") return ":missionId";
      if (previous === "planet" || previous === "planets") return ":planetId";
      return ":id";
    }
    return part;
  });
  return `/${normalized.join("/")}`;
}

