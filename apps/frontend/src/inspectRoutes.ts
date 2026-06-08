import type { Page } from "./components/NavBar";
import type { Coordinates } from "./types";

export type InspectRoute =
  | { kind: "page"; page: Page }
  | { kind: "planet"; coords: Coordinates }
  | { kind: "mission"; missionId: string }
  | { kind: "player"; wallet: string }
  | { kind: "alliance"; allianceId: string }
  | { kind: "mission-report"; missionId: string };

const pageNames = new Set<Page>([
  "overview",
  "infrastructure",
  "defenses",
  "research",
  "shipyard",
  "mission-control",
  "moon",
  "alliance",
  "rift",
  "rankings",
  "galaxy",
  "planet",
  "battle-reports",
]);

function parsePlanetCoords(query: string): Coordinates | null {
  const params = new URLSearchParams(query);
  const galaxy = Number(params.get("galaxy"));
  const system = Number(params.get("system"));
  const position = Number(params.get("position"));
  if ([galaxy, system, position].every((value) => Number.isInteger(value) && value > 0)) {
    return { galaxy, system, position };
  }
  return null;
}

export function parseInspectRoute(hash: string): InspectRoute {
  const withoutHash = hash.replace(/^#/, "").replace(/^\/+/, "");
  const [path = "", query = ""] = withoutHash.split("?");
  if (!path) return { kind: "page", page: "overview" };

  const [kind, value, detailId, positionId] = path.split("/");
  if (kind === "player" && value) {
    return { kind: "player", wallet: decodeURIComponent(value) };
  }
  if (kind === "alliance" && value) {
    return { kind: "alliance", allianceId: decodeURIComponent(value) };
  }
  // Legacy `#/battle-report/<id>` deep links now resolve to the unified mission
  // detail page, which is itself the shareable public report.
  if (kind === "battle-report" && value && /^[0-9]+$/.test(decodeURIComponent(value))) {
    return { kind: "mission", missionId: decodeURIComponent(value) };
  }
  if (kind === "mission" && value && /^[0-9]+$/.test(decodeURIComponent(value))) {
    return { kind: "mission", missionId: decodeURIComponent(value) };
  }
  if (kind === "mission-control" && value === "report" && detailId) {
    return { kind: "mission-report", missionId: decodeURIComponent(detailId) };
  }
  if (kind === "planet") {
    // Canonical path form (#/planet/<galaxy>/<system>/<position>) with a
    // legacy query-string fallback (#/planet?galaxy=&system=&position=) so
    // deep links and reloads keep the selected planet instead of dropping to
    // the overview page.
    const pathCoords = parsePlanetCoords(
      `galaxy=${value ?? ""}&system=${detailId ?? ""}&position=${positionId ?? ""}`,
    );
    const coords = pathCoords ?? parsePlanetCoords(query);
    if (coords) {
      return { kind: "planet", coords };
    }
    return { kind: "page", page: "planet" };
  }
  if (pageNames.has(kind as Page)) {
    return { kind: "page", page: kind as Page };
  }
  return { kind: "page", page: "overview" };
}

export function buildInspectHash(route: InspectRoute): string {
  if (route.kind === "planet") {
    return `#/planet/${route.coords.galaxy}/${route.coords.system}/${route.coords.position}`;
  }
  if (route.kind === "player") return `#/player/${encodeURIComponent(route.wallet)}`;
  if (route.kind === "alliance") return `#/alliance/${encodeURIComponent(route.allianceId)}`;
  if (route.kind === "mission") return `#/mission/${encodeURIComponent(route.missionId)}`;
  if (route.kind === "mission-report") return `#/mission-control/report/${encodeURIComponent(route.missionId)}`;
  return route.page === "overview" ? "#/" : `#/${route.page}`;
}
