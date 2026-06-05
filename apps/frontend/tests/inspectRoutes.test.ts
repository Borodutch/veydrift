import { describe, expect, test } from "bun:test";
import { buildInspectHash, parseInspectRoute } from "../src/inspectRoutes";

describe("inspect routes", () => {
  test("parses dedicated player and alliance hash routes", () => {
    expect(parseInspectRoute("#/player/0xabc")).toEqual({ kind: "player", wallet: "0xabc" });
    expect(parseInspectRoute("#/alliance/7")).toEqual({ kind: "alliance", allianceId: "7" });
    expect(parseInspectRoute("#/battle-report/12")).toEqual({ kind: "battle-report", missionId: "12" });
    expect(parseInspectRoute("#/mission-control/report/12")).toEqual({ kind: "mission-report", missionId: "12" });
  });

  test("round-trips page and inspect hashes", () => {
    expect(buildInspectHash({ kind: "page", page: "rankings" })).toBe("#/rankings");
    expect(buildInspectHash({ kind: "player", wallet: "0x1111111111111111111111111111111111111111" })).toBe("#/player/0x1111111111111111111111111111111111111111");
    expect(buildInspectHash({ kind: "alliance", allianceId: "fleet 7" })).toBe("#/alliance/fleet%207");
    expect(buildInspectHash({ kind: "battle-report", missionId: "12" })).toBe("#/battle-report/12");
    expect(buildInspectHash({ kind: "mission-report", missionId: "attack 12" })).toBe("#/mission-control/report/attack%2012");
    expect(parseInspectRoute("#/alliance/fleet%207")).toEqual({ kind: "alliance", allianceId: "fleet 7" });
    expect(parseInspectRoute("#/battle-report/12")).toEqual({ kind: "battle-report", missionId: "12" });
    expect(parseInspectRoute("#/mission-control/report/attack%2012")).toEqual({ kind: "mission-report", missionId: "attack 12" });
  });

  test("falls back to overview for unknown routes", () => {
    expect(parseInspectRoute("#/missing/route")).toEqual({ kind: "page", page: "overview" });
    expect(parseInspectRoute("")).toEqual({ kind: "page", page: "overview" });
  });
});
