import { describe, expect, test } from "bun:test";

import { confirmedFleetVisibility, shouldRenderMissileStrikeHistory } from "./missionVisibilityRefresh";

const visibility = {
  wallet: "0x1111111111111111111111111111111111111111",
  homePlanetId: "7",
  incoming: [],
  outgoing: [],
  returning: [],
  joinableAttacks: [],
  completedMissions: [],
  battleReports: [],
};

describe("mission visibility refresh stability", () => {
  test("does not synthesize an empty mission feed from a failed read", () => {
    expect(confirmedFleetVisibility({ status: "rejected", reason: new Error("timed out") })).toBeUndefined();
    expect(confirmedFleetVisibility({ status: "fulfilled", value: visibility })).toEqual(visibility);
  });

  test("keeps an empty missile history hidden during polling", () => {
    expect(shouldRenderMissileStrikeHistory({ rowCount: 0 })).toBe(false);
    expect(shouldRenderMissileStrikeHistory({ rowCount: 0, error: "Missile strike history could not be loaded." })).toBe(true);
    expect(shouldRenderMissileStrikeHistory({ rowCount: 1 })).toBe(true);
  });
});
