import { describe, expect, test } from "bun:test";
import { buildInspectHash, parseInspectPath, parseInspectRoute, parseInspectRouteFromLocation } from "../src/inspectRoutes";

describe("inspect routes", () => {
  test("parses dedicated player and alliance hash routes", () => {
    expect(parseInspectRoute("#/player/0xabc")).toEqual({ kind: "player", wallet: "0xabc" });
    expect(parseInspectRoute("#/alliance/7")).toEqual({ kind: "alliance", allianceId: "7" });
    // Legacy single battle-report links redirect to the unified mission detail page.
    expect(parseInspectRoute("#/battle-report/12")).toEqual({ kind: "mission", missionId: "12" });
    expect(parseInspectRoute("#/mission-control/report/12")).toEqual({ kind: "mission-report", missionId: "12" });
  });

  test("round-trips page and inspect hashes", () => {
    expect(buildInspectHash({ kind: "page", page: "rankings" })).toBe("#/rankings");
    expect(buildInspectHash({ kind: "player", wallet: "0x1111111111111111111111111111111111111111" })).toBe("#/player/0x1111111111111111111111111111111111111111");
    expect(buildInspectHash({ kind: "alliance", allianceId: "fleet 7" })).toBe("#/alliance/fleet%207");
    expect(buildInspectHash({ kind: "mission-report", missionId: "attack 12" })).toBe("#/mission-control/report/attack%2012");
    expect(parseInspectRoute("#/alliance/fleet%207")).toEqual({ kind: "alliance", allianceId: "fleet 7" });
    expect(parseInspectRoute("#/battle-report/12")).toEqual({ kind: "mission", missionId: "12" });
    expect(parseInspectRoute("#/mission-control/report/attack%2012")).toEqual({ kind: "mission-report", missionId: "attack 12" });
  });

  test("parses clean share path routes for first-load OG URLs", () => {
    expect(parseInspectPath("/mission/2104")).toEqual({ kind: "mission", missionId: "2104" });
    expect(parseInspectPath("/mission-control/report/2104")).toEqual({ kind: "mission-report", missionId: "2104" });
    expect(parseInspectPath("/planet/6/9/7")).toEqual({
      kind: "planet",
      coords: { galaxy: 6, system: 9, position: 7 },
    });
    expect(parseInspectPath("/player/0xabc")).toEqual({ kind: "player", wallet: "0xabc" });
    expect(parseInspectPath("/alliance/fleet%207")).toEqual({ kind: "alliance", allianceId: "fleet 7" });
  });

  test("prefers hash routes but falls back to clean path routes", () => {
    expect(parseInspectRouteFromLocation({ hash: "", pathname: "/mission/2104" })).toEqual({
      kind: "mission",
      missionId: "2104",
    });
    expect(parseInspectRouteFromLocation({ hash: "#/rankings", pathname: "/mission/2104" })).toEqual({
      kind: "page",
      page: "rankings",
    });
  });

  test("falls back to overview for unknown routes", () => {
    expect(parseInspectRoute("#/missing/route")).toEqual({ kind: "page", page: "overview" });
    expect(parseInspectRoute("")).toEqual({ kind: "page", page: "overview" });
  });

  test("keeps planet detail coordinates in the route so reloads/deep links persist", () => {
    expect(parseInspectRoute("#/planet/5/407/4")).toEqual({
      kind: "planet",
      coords: { galaxy: 5, system: 407, position: 4 },
    });
    expect(buildInspectHash({ kind: "planet", coords: { galaxy: 5, system: 407, position: 4 } })).toBe("#/planet/5/407/4");
    // Legacy query-string deep links still resolve to the selected planet.
    expect(parseInspectRoute("#/planet?galaxy=5&system=407&position=4")).toEqual({
      kind: "planet",
      coords: { galaxy: 5, system: 407, position: 4 },
    });
    // A coordinate-less planet hash degrades to the planet page rather than overview.
    expect(parseInspectRoute("#/planet")).toEqual({ kind: "page", page: "planet" });
    // Invalid/partial coordinates do not produce a planet route.
    expect(parseInspectRoute("#/planet/5/407")).toEqual({ kind: "page", page: "planet" });
    expect(parseInspectRoute("#/planet/0/407/4")).toEqual({ kind: "page", page: "planet" });
  });
});
