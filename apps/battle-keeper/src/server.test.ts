import { describe, expect, test } from "bun:test";

import { MissionType } from "./events";
import { BattleKeeper, type KeeperLogger } from "./keeper";
import type { MissionResolver } from "./resolver";
import { createHandler } from "./server";
import { WsBattleListener } from "./wsListener";

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
    expect(body.keeper.keeperAddress).toBe("0x000000000000000000000000000000000000dEaD");
    expect(body.ws.connected).toBe(false);
    expect(body.status).toBe("degraded"); // ws not connected
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
});
