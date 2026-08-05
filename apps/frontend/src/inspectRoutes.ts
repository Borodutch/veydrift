import type { Page } from "./components/NavBar";
import type { Coordinates } from "./types";

export type InspectRoute =
  | { kind: "page"; page: Page }
  | { kind: "planet"; coords: Coordinates }
  | { kind: "moon"; coords: Coordinates }
  | { kind: "mission"; missionId: string }
  | { kind: "player"; wallet: string }
  | { kind: "alliance"; allianceId: string }
  | { kind: "mission-report"; missionId: string };

export type PlanetDetailBackRoute = Exclude<InspectRoute, { kind: "planet" } | { kind: "moon" }>;

export type ManagedPlanetInspectTarget = {
  galaxy: number;
  moon?: { exists: boolean } | null | undefined;
  planetId: string;
  position: number;
  system: number;
};

export type ManagedPlanetInspectSelection = {
  bodyKind: "moon" | "planet";
  planetId: string;
};

const pageNames = new Set<Page>([
  "overview",
  "infrastructure",
  "defenses",
  "research",
  "shipyard",
  "mission-control",
  "moon",
  "alliance",
  "alliance-invites",
  "rift",
  "rankings",
  "galaxy",
  "raid-target-finder",
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

function parseInspectPathValue(rawPath: string): InspectRoute | null {
  const withoutHash = rawPath.replace(/^#/, "").replace(/^\/+/, "");
  const [path = "", query = ""] = withoutHash.split("?");
  if (!path) return null;

  const [kind, value, detailId, positionId] = path.split("/");
  if (kind === "player" && value) {
    return { kind: "player", wallet: decodeURIComponent(value) };
  }
  if (kind === "alliance" && value) {
    return { kind: "alliance", allianceId: decodeURIComponent(value) };
  }
  // Legacy `#/battle-report/<id>` deep links resolve to the unified mission
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
  if (kind === "missions") {
    return { kind: "page", page: "mission-control" };
  }
  if (kind === "planet") {
    // Canonical path form (/planet/<galaxy>/<system>/<position>) with a
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
  if (kind === "moon") {
    const pathCoords = parsePlanetCoords(
      `galaxy=${value ?? ""}&system=${detailId ?? ""}&position=${positionId ?? ""}`,
    );
    const coords = pathCoords ?? parsePlanetCoords(query);
    if (coords) {
      return { kind: "moon", coords };
    }
    return { kind: "page", page: "moon" };
  }
  if (kind === "invite" || kind === "alliance-invites") {
    return { kind: "page", page: "alliance-invites" };
  }
  if (pageNames.has(kind as Page)) {
    return { kind: "page", page: kind as Page };
  }
  return null;
}

export function parseInspectRoute(hash: string): InspectRoute {
  return parseInspectPathValue(hash) ?? { kind: "page", page: "overview" };
}

export function parseInspectPath(pathname: string): InspectRoute | null {
  return parseInspectPathValue(pathname);
}

export function parseInspectRouteFromLocation(location: Pick<Location, "hash" | "pathname">): InspectRoute {
  const pathRoute = parseInspectPath(location.pathname);
  if (pathRoute) return pathRoute;

  const isLegacyHashEntry = location.pathname === "/" || location.pathname === "/index.html";
  if (isLegacyHashEntry && location.hash && location.hash !== "#" && location.hash !== "#/") {
    return parseInspectRoute(location.hash);
  }
  return { kind: "page", page: "overview" };
}

export function canonicalPathForLegacyHashLocation(location: Pick<Location, "hash" | "pathname" | "search">): string | null {
  if (location.pathname !== "/" && location.pathname !== "/index.html") return null;
  if (!location.hash || location.hash === "#" || location.hash === "#/") return null;

  const route = parseInspectPathValue(location.hash);
  if (!route) return null;

  if (route.kind === "page" && route.page === "mission-control" && location.hash.includes("?")) {
    const params = new URLSearchParams(location.search);
    const legacyViewParams = new URLSearchParams(location.hash.slice(location.hash.indexOf("?") + 1));
    legacyViewParams.forEach((value, key) => params.set(key, value));
    const query = params.toString();
    return `${buildInspectPath(route)}${query ? `?${query}` : ""}`;
  }

  return `${buildInspectPath(route)}${location.search}`;
}

export function buildInspectPath(route: InspectRoute): string {
  if (route.kind === "planet") {
    return `/planet/${route.coords.galaxy}/${route.coords.system}/${route.coords.position}`;
  }
  if (route.kind === "moon") {
    return `/moon/${route.coords.galaxy}/${route.coords.system}/${route.coords.position}`;
  }
  if (route.kind === "player") return `/player/${encodeURIComponent(route.wallet)}`;
  if (route.kind === "alliance") return `/alliance/${encodeURIComponent(route.allianceId)}`;
  if (route.kind === "mission") return `/mission/${encodeURIComponent(route.missionId)}`;
  if (route.kind === "mission-report") return `/mission-control/report/${encodeURIComponent(route.missionId)}`;
  if (route.page === "alliance-invites") return "/invite";
  return route.page === "overview" ? "/" : `/${route.page}`;
}

export function planetDetailBackRouteForCurrentScreen({
  inspectedAllianceId,
  inspectedPlayerWallet,
  missionDetailId,
  missionReportId,
  page,
}: {
  inspectedAllianceId: string | null;
  inspectedPlayerWallet: string | null;
  missionDetailId: string | null;
  missionReportId: string | null;
  page: Page;
}): PlanetDetailBackRoute {
  if (missionReportId) {
    return { kind: "mission-report", missionId: missionReportId };
  }
  if (missionDetailId) {
    return { kind: "mission", missionId: missionDetailId };
  }
  if (page === "player-inspect" && inspectedPlayerWallet) {
    return { kind: "player", wallet: inspectedPlayerWallet };
  }
  if (page === "alliance-inspect" && inspectedAllianceId) {
    return { kind: "alliance", allianceId: inspectedAllianceId };
  }
  return { kind: "page", page: page === "planet" ? "galaxy" : page };
}

export function hasUsefulPlanetDetailBackRoute(route: InspectRoute | null | undefined): route is PlanetDetailBackRoute {
  return Boolean(route && route.kind !== "planet" && route.kind !== "moon" && !(route.kind === "page" && route.page === "planet"));
}

export function inspectRouteForManagedPlanetSelection(
  page: Page,
  bodyKind: "moon" | "planet",
  planet: ManagedPlanetInspectTarget | undefined,
): Extract<InspectRoute, { kind: "moon" | "planet" }> | null {
  if (!planet || (page !== "planet" && page !== "moon-inspect")) return null;

  const coords = {
    galaxy: planet.galaxy,
    system: planet.system,
    position: planet.position,
  };
  return bodyKind === "moon" && planet.moon?.exists
    ? { kind: "moon", coords }
    : { kind: "planet", coords };
}

export function managedPlanetSelectionForInspectRoute(
  route: Extract<InspectRoute, { kind: "moon" | "planet" }> | null,
  planets: readonly ManagedPlanetInspectTarget[],
): ManagedPlanetInspectSelection | null {
  if (!route) return null;
  const planet = planets.find((candidate) => (
    candidate.galaxy === route.coords.galaxy
    && candidate.system === route.coords.system
    && candidate.position === route.coords.position
  ));
  if (!planet) return null;

  return {
    bodyKind: route.kind === "moon" && planet.moon?.exists ? "moon" : "planet",
    planetId: planet.planetId,
  };
}
