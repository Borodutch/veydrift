import type { Page } from "./components/NavBar";

export type InspectRoute =
  | { kind: "page"; page: Page }
  | { kind: "battle-report"; missionId: string }
  | { kind: "player"; wallet: string }
  | { kind: "alliance"; allianceId: string };

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
]);

export function parseInspectRoute(hash: string): InspectRoute {
  const route = hash.replace(/^#/, "").replace(/^\/+/, "");
  if (!route) return { kind: "page", page: "overview" };

  const [kind, value] = route.split("/");
  if (kind === "player" && value) {
    return { kind: "player", wallet: decodeURIComponent(value) };
  }
  if (kind === "alliance" && value) {
    return { kind: "alliance", allianceId: decodeURIComponent(value) };
  }
  if (kind === "battle-report" && value && /^[0-9]+$/.test(decodeURIComponent(value))) {
    return { kind: "battle-report", missionId: decodeURIComponent(value) };
  }
  if (pageNames.has(kind as Page)) {
    return { kind: "page", page: kind as Page };
  }
  return { kind: "page", page: "overview" };
}

export function buildInspectHash(route: InspectRoute): string {
  if (route.kind === "player") return `#/player/${encodeURIComponent(route.wallet)}`;
  if (route.kind === "alliance") return `#/alliance/${encodeURIComponent(route.allianceId)}`;
  if (route.kind === "battle-report") return `#/battle-report/${encodeURIComponent(route.missionId)}`;
  return route.page === "overview" ? "#/" : `#/${route.page}`;
}
