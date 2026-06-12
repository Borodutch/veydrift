import type { BattleKeeper, KeeperSnapshot } from "./keeper";
import type { WsBattleListener, WsListenerSnapshot } from "./wsListener";

export type KeeperHealth = {
  ok: boolean;
  status: "healthy" | "degraded";
  pendingCount: number;
  lastResolvedMissionId: string | null;
  lastResolvedAt: string | null;
  lastError: string | null;
  keeper: KeeperSnapshot;
  ws: WsListenerSnapshot;
  uptimeSeconds: number;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8" } as const;

export function buildHealth(
  keeper: BattleKeeper,
  ws: WsBattleListener,
  startedAtMs: number,
  nowMs: number
): KeeperHealth {
  const keeperSnapshot = keeper.snapshot();
  const wsSnapshot = ws.snapshot();
  // "ok" reflects liveness, not the presence of a transient retryable error: a not-yet-committed
  // randomness revert is expected. We only flag degraded when the WS feed is down (the sweep still
  // covers us, but it's worth surfacing).
  const ok = wsSnapshot.connected;
  return {
    ok,
    status: ok ? "healthy" : "degraded",
    pendingCount: keeperSnapshot.pendingCount,
    lastResolvedMissionId: keeperSnapshot.lastResolvedMissionId,
    lastResolvedAt: keeperSnapshot.lastResolvedAt,
    lastError: keeperSnapshot.lastError,
    keeper: keeperSnapshot,
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
  now: () => number = () => Date.now()
): (request: Request) => Response {
  return (request: Request): Response => {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      const health = buildHealth(keeper, ws, startedAtMs, now());
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
