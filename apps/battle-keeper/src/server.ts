import type { BattleKeeper, KeeperSnapshot, PendingMissionDiagnostic } from "./keeper";
import type { SweepSnapshot } from "./sweep";
import type { RpcTransportSnapshot } from "./transport";
import type { WsBattleListener, WsListenerSnapshot } from "./wsListener";

export type KeeperBuildInfo = {
  gitSha: string | null;
};

export type KeeperHealthOptions = {
  build?: KeeperBuildInfo;
  rpc?: { snapshot: () => RpcTransportSnapshot };
  sweep?: { snapshot: () => SweepSnapshot };
  staleDueSeconds?: number;
};

export type KeeperHealth = {
  ok: boolean;
  status: "healthy" | "degraded";
  pendingCount: number;
  lastResolvedMissionId: string | null;
  lastResolvedAt: string | null;
  lastError: string | null;
  healthWarnings: string[];
  staleDueMissions: PendingMissionDiagnostic[];
  build: KeeperBuildInfo;
  keeper: KeeperSnapshot;
  rpc: RpcTransportSnapshot | null;
  sweep: SweepSnapshot | null;
  ws: WsListenerSnapshot;
  uptimeSeconds: number;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8" } as const;
const defaultStaleDueSeconds = 120;

export function buildInfoFromEnv(env: NodeJS.ProcessEnv = process.env): KeeperBuildInfo {
  return {
    gitSha:
      env.GIT_SHA?.trim() ||
      env.SOURCE_VERSION?.trim() ||
      env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
      env.EASYPANEL_GIT_SHA?.trim() ||
      null
  };
}

export function buildHealth(
  keeper: BattleKeeper,
  ws: WsBattleListener,
  startedAtMs: number,
  nowMs: number,
  options: KeeperHealthOptions = {}
): KeeperHealth {
  const keeperSnapshot = keeper.snapshot();
  const rpcSnapshot = options.rpc?.snapshot() ?? null;
  const wsSnapshot = ws.snapshot();
  const sweepSnapshot = options.sweep?.snapshot() ?? null;
  const healthWarnings: string[] = [];
  const staleDueSeconds = options.staleDueSeconds ?? defaultStaleDueSeconds;
  const staleDueMissions = keeperSnapshot.dueMissions.filter(
    (mission) => mission.dueAgeSeconds >= staleDueSeconds && mission.retryCount > 0
  );
  if (!wsSnapshot.connected) {
    healthWarnings.push("websocket_disconnected");
  }
  if (staleDueMissions.length > 0) {
    healthWarnings.push("stale_due_retry_backlog");
  }
  if (sweepSnapshot?.lastSweepError) {
    healthWarnings.push("sweep_failed");
  }

  // "ok" is liveness/readiness for the process health check. `status` carries operational
  // degradation, including retry storms, without forcing EasyPanel to restart a live keeper.
  const ok = wsSnapshot.connected;
  return {
    ok,
    status: healthWarnings.length === 0 ? "healthy" : "degraded",
    pendingCount: keeperSnapshot.pendingCount,
    lastResolvedMissionId: keeperSnapshot.lastResolvedMissionId,
    lastResolvedAt: keeperSnapshot.lastResolvedAt,
    lastError: keeperSnapshot.lastError,
    healthWarnings,
    staleDueMissions,
    build: options.build ?? buildInfoFromEnv(),
    keeper: keeperSnapshot,
    rpc: rpcSnapshot,
    sweep: sweepSnapshot,
    ws: wsSnapshot,
    uptimeSeconds: Math.floor((nowMs - startedAtMs) / 1_000)
  };
}

/** Pure request handler — testable without binding a socket. GET /health and GET / both return the
 * health snapshot; everything else is 404. */
export function createHandler(
  keeper: BattleKeeper,
  ws: WsBattleListener,
  startedAtMs: number,
  now: () => number = () => Date.now(),
  options: KeeperHealthOptions = {}
): (request: Request) => Response {
  return (request: Request): Response => {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      const health = buildHealth(keeper, ws, startedAtMs, now(), options);
      return new Response(JSON.stringify(health, null, 2), {
        status: health.ok ? 200 : 503,
        headers: jsonHeaders
      });
    }
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: jsonHeaders
    });
  };
}
