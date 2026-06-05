import { describe, expect, test } from "bun:test";
import { buildInspectHash, parseInspectRoute } from "../src/inspectRoutes";

describe("inspect routes", () => {
  test("parses dedicated player and alliance hash routes", () => {
    expect(parseInspectRoute("#/player/0xabc")).toEqual({ kind: "player", wallet: "0xabc" });
    expect(parseInspectRoute("#/alliance/7")).toEqual({ kind: "alliance", allianceId: "7" });
  });

  test("round-trips page and inspect hashes", () => {
    expect(buildInspectHash({ kind: "page", page: "rankings" })).toBe("#/rankings");
    expect(buildInspectHash({ kind: "player", wallet: "0x1111111111111111111111111111111111111111" })).toBe("#/player/0x1111111111111111111111111111111111111111");
    expect(buildInspectHash({ kind: "alliance", allianceId: "fleet 7" })).toBe("#/alliance/fleet%207");
    expect(parseInspectRoute("#/alliance/fleet%207")).toEqual({ kind: "alliance", allianceId: "fleet 7" });
  });

  test("falls back to overview for unknown routes", () => {
    expect(parseInspectRoute("#/missing/route")).toEqual({ kind: "page", page: "overview" });
    expect(parseInspectRoute("")).toEqual({ kind: "page", page: "overview" });
  });
});
