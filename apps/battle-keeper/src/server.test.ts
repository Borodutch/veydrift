import { describe, expect, test } from "bun:test";

import { MissionType } from "./events";
import { BattleKeeper, type KeeperLogger } from "./keeper";
import type { MissionResolver } from "./resolver";
import { buildHealth, createHandler } from "./server";
import { WsBattleListener } from "./wsListener";
import type { WsListenerSnapshot } from "./wsListener";

const silentLogger: KeeperLogger = { info: () => {}, warn: () => {}, error: () => {} };

const mockResolver: MissionResolver = {
  keeperAddress: () => "0x000000000000000000000000000000000000dEaD",
  resolveMission: async () => "0xhash"
};

function setup(): { handler: (request: Request) => Response; keeper: BattleKeeper } {
  const keeper = new BattleKeeper(mockResolver, { logger: silentLogger, now: () => 1_000 });
  // Listener constructed but never started → reports disconnected.
  const listener = new WsBattleListener(
    "ws://localhost:1",
    "0xf12f31734868F1089d9d6514D7F19a31Ec5e00e2",
    keeper,
    { logger: silentLogger }
  );
  const handler = createHandler(keeper, listener, 0, () => 5_000);
  return { handler, keeper };
}

describe("health handler", () => {
  test("GET /health returns the snapshot", async () => {
    const { handler, keeper } = setup();
    keeper.recordLaunched({ missionId: "1", missionType: MissionType.Attack, arrivalAt: 500, returnAt: 900 });

    const res = handler(new Request("http://localhost/health"));
    const body = await res.json();
    expect(body.pendingCount).toBe(1);
    expect(body.keeper.dueMissionCount).toBe(1);
    expect(body.keeper.oldestDueAgeSeconds).toBe(500);
    expect(body.keeper.keeperAddress).toBe("0x000000000000000000000000000000000000dEaD");
    expect(body.ws.connected).toBe(false);
    expect(body.status).toBe("degraded"); // ws not connected
    expect(body.healthWarnings).toContain("websocket_disconnected");
    expect(res.status).toBe(503);
    expect(body.uptimeSeconds).toBe(5); // (5000 - 0) / 1000
  });

  test("GET / returns the same snapshot", async () => {
    const { handler } = setup();
    const res = handler(new Request("http://localhost/"));
    const body = await res.json();
    expect(body).toHaveProperty("pendingCount");
    expect(body).toHaveProperty("keeper");
    expect(body).toHaveProperty("ws");
  });

  test("unknown routes 404", () => {
    const { handler } = setup();
    const res = handler(new Request("http://localhost/nope"));
    expect(res.status).toBe(404);
  });

  test("reports build identity and stale retry backlog without failing liveness", async () => {
    const keeper = new BattleKeeper(
      {
        keeperAddress: () => "0x000000000000000000000000000000000000dEaD",
        resolveMission: async (missionId) => {
          throw new Error(`mission ${missionId} not resolvable yet`);
        }
      },
      { logger: silentLogger, now: () => 1_000 }
    );
    keeper.recordLaunched({ missionId: "4347", missionType: MissionType.Attack, arrivalAt: 700, returnAt: 900 });
    // Record the failure signal health uses to distinguish a stale retry backlog from merely due work.
    await keeper.tick();

    const ws = {
      snapshot: (): WsListenerSnapshot => ({
        connected: true,
        reconnectAttempts: 0,
        eventsReceived: 1,
        lastConnectedAt: "2026-06-18T00:00:00.000Z",
        lastEventAt: "2026-06-18T00:00:01.000Z",
        lastError: null
      })
    } as WsBattleListener;

    const health = buildHealth(keeper, ws, 0, 1_000_000, {
      build: { gitSha: "ad1b95e" },
      staleDueSeconds: 120
    });

    expect(health.ok).toBe(true);
    expect(health.status).toBe("degraded");
    expect(health.healthWarnings).toContain("stale_due_retry_backlog");
    expect(health.build.gitSha).toBe("ad1b95e");
    expect(health.keeper.oldestDueAgeSeconds).toBe(300);
    expect(health.keeper.oldestDueMissionId).toBe("4347");
    expect(health.keeper.oldestDueMissionLeg).toBe("arrival");
    expect(health.staleDueMissions).toEqual([
      expect.objectContaining({
        missionId: "4347",
        missionTypeName: "Attack",
        leg: "arrival",
        dueAgeSeconds: 300,
        retryCount: 1,
        lastError: expect.stringContaining("mission 4347 not resolvable yet")
      })
    ]);
  });
});
