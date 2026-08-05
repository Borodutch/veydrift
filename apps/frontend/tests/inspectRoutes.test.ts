import { describe, expect, test } from "bun:test";
import {
  buildInspectPath,
  canonicalPathForLegacyHashLocation,
  parseInspectPath,
  parseInspectRoute,
  parseInspectRouteFromLocation,
} from "../src/inspectRoutes";

describe("inspect routes", () => {
  test("keeps legacy hash links readable", () => {
    expect(parseInspectRoute("#/player/0xabc")).toEqual({ kind: "player", wallet: "0xabc" });
    expect(parseInspectRoute("#/alliance/7")).toEqual({ kind: "alliance", allianceId: "7" });
    // Legacy single battle-report links redirect to the unified mission detail page.
    expect(parseInspectRoute("#/battle-report/12")).toEqual({ kind: "mission", missionId: "12" });
    expect(parseInspectRoute("#/mission-control/report/12")).toEqual({ kind: "mission-report", missionId: "12" });
  });

  test("decodes legacy hash link values", () => {
    expect(parseInspectRoute("#/alliance/fleet%207")).toEqual({ kind: "alliance", allianceId: "fleet 7" });
    expect(parseInspectRoute("#/battle-report/12")).toEqual({ kind: "mission", missionId: "12" });
    expect(parseInspectRoute("#/mission-control/report/attack%2012")).toEqual({ kind: "mission-report", missionId: "attack 12" });
  });

  test("builds clean shareable paths for all routes", () => {
    expect(buildInspectPath({ kind: "page", page: "rankings" })).toBe("/rankings");
    expect(buildInspectPath({ kind: "page", page: "overview" })).toBe("/");
    expect(buildInspectPath({ kind: "mission", missionId: "2104" })).toBe("/mission/2104");
    expect(buildInspectPath({ kind: "planet", coords: { galaxy: 6, system: 9, position: 1 } })).toBe("/planet/6/9/1");
    expect(buildInspectPath({ kind: "moon", coords: { galaxy: 6, system: 9, position: 1 } })).toBe("/moon/6/9/1");
    expect(buildInspectPath({ kind: "player", wallet: "0x4e15e6643964f1a3d3a5af82d7683b9a30553aa1" })).toBe(
      "/player/0x4e15e6643964f1a3d3a5af82d7683b9a30553aa1",
    );
    expect(buildInspectPath({ kind: "alliance", allianceId: "fleet 7" })).toBe("/alliance/fleet%207");
  });

  test("parses clean share path routes for first-load OG URLs", () => {
    expect(parseInspectPath("/missions")).toEqual({ kind: "page", page: "mission-control" });
    expect(parseInspectPath("/mission-control")).toEqual({ kind: "page", page: "mission-control" });
    expect(parseInspectPath("/mission/2104")).toEqual({ kind: "mission", missionId: "2104" });
    expect(parseInspectPath("/mission-control/report/2104")).toEqual({ kind: "mission-report", missionId: "2104" });
    expect(parseInspectPath("/planet/6/9/7")).toEqual({
      kind: "planet",
      coords: { galaxy: 6, system: 9, position: 7 },
    });
    expect(parseInspectPath("/moon/6/9/7")).toEqual({
      kind: "moon",
      coords: { galaxy: 6, system: 9, position: 7 },
    });
    expect(parseInspectPath("/player/0xabc")).toEqual({ kind: "player", wallet: "0xabc" });
    expect(parseInspectPath("/alliance/fleet%207")).toEqual({ kind: "alliance", allianceId: "fleet 7" });
  });

  test("prefers clean path routes and reads legacy hashes only at the root", () => {
    expect(parseInspectRouteFromLocation({ hash: "", pathname: "/mission/2104" })).toEqual({
      kind: "mission",
      missionId: "2104",
    });
    expect(parseInspectRouteFromLocation({ hash: "#/rankings", pathname: "/mission/2104" })).toEqual({
      kind: "mission",
      missionId: "2104",
    });
    expect(parseInspectRouteFromLocation({ hash: "#/rankings", pathname: "/" })).toEqual({ kind: "page", page: "rankings" });
  });

  test("canonicalizes all legacy hash links to clean paths", () => {
    expect(canonicalPathForLegacyHashLocation({ hash: "#/planet/6/9/13", pathname: "/", search: "" })).toBe("/planet/6/9/13");
    expect(canonicalPathForLegacyHashLocation({ hash: "#/moon/6/9/13", pathname: "/", search: "" })).toBe("/moon/6/9/13");
    expect(canonicalPathForLegacyHashLocation({ hash: "#/player/0xabc", pathname: "/", search: "?miniApp=true" })).toBe(
      "/player/0xabc?miniApp=true",
    );
    expect(canonicalPathForLegacyHashLocation({ hash: "#/rankings", pathname: "/", search: "" })).toBe("/rankings");
    expect(
      canonicalPathForLegacyHashLocation({
        hash: "#/mission-control?at=alliance&ap=2",
        pathname: "/",
        search: "?miniApp=true",
      }),
    ).toBe("/mission-control?miniApp=true&at=alliance&ap=2");
    expect(canonicalPathForLegacyHashLocation({ hash: "#/missing/route", pathname: "/", search: "" })).toBeNull();
    expect(canonicalPathForLegacyHashLocation({ hash: "#/planet/6/9/13", pathname: "/mission/2104", search: "" })).toBeNull();
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
    expect(buildInspectPath({ kind: "planet", coords: { galaxy: 5, system: 407, position: 4 } })).toBe("/planet/5/407/4");
    expect(buildInspectPath({ kind: "moon", coords: { galaxy: 5, system: 407, position: 4 } })).toBe("/moon/5/407/4");
    // Legacy query-string deep links still resolve to the selected planet.
    expect(parseInspectRoute("#/planet?galaxy=5&system=407&position=4")).toEqual({
      kind: "planet",
      coords: { galaxy: 5, system: 407, position: 4 },
    });
    // A coordinate-less planet hash degrades to the planet page rather than overview.
    expect(parseInspectRoute("#/planet")).toEqual({ kind: "page", page: "planet" });
    expect(parseInspectRoute("#/moon")).toEqual({ kind: "page", page: "moon" });
    // Invalid/partial coordinates do not produce a planet route.
    expect(parseInspectRoute("#/planet/5/407")).toEqual({ kind: "page", page: "planet" });
    expect(parseInspectRoute("#/planet/0/407/4")).toEqual({ kind: "page", page: "planet" });
  });
});
