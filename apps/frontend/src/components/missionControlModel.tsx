import type { Coordinates, PlanetType } from "../types";
import { type FleetMissionPlanetReference, type FleetMissionSummary } from "../walletFlow";

export type MissionControlDirectionFilter = "" | "outbound" | "returning";

export type MissionControlFilters = {
  direction: MissionControlDirectionFilter;
  missionNumber: string;
  missionType: string;
  planetId: string;
};

export const EMPTY_MISSION_CONTROL_FILTERS: MissionControlFilters = {
  direction: "",
  missionNumber: "",
  missionType: "",
  planetId: "",
};

export const EMPTY_PLANET_ARCHETYPE_LOOKUP: ReadonlyMap<string, PlanetType> = new Map();

export const ACTIVE_MISSION_TABS = [
  // The one active-section empty state: the tab panel says it, so no separate page-level notice
  // repeats it two lines above.
  { emptyLabel: "No active missions for this wallet. Use Galaxy to launch attacks, transport resources, deploy fleets, or harvest debris.", key: "mine", label: "My missions" },
  { emptyLabel: "No fleets are currently inbound to your planets.", key: "incoming", label: "Incoming" },
  { emptyLabel: "No joinable alliance attacks or defenses.", key: "alliance", label: "Alliance" },
  { emptyLabel: "No active missions in the universe yet.", key: "all", label: "All" },
] as const;

export type ActiveMissionTabKey = (typeof ACTIVE_MISSION_TABS)[number]["key"];

export const ACTIVE_MISSION_DEFAULT_TAB: ActiveMissionTabKey = "mine";

export const PAST_MISSION_TABS = [
  { emptyLabel: "No completed missions are visible for this wallet yet.", key: "mine", label: "My missions" },
  { emptyLabel: "No completed incoming attacks are visible for this wallet yet.", key: "incomingAttacks", label: "Incoming attacks" },
  { emptyLabel: "No completed missions in the universe yet.", key: "all", label: "All" },
] as const;

export type PastMissionTabKey = (typeof PAST_MISSION_TABS)[number]["key"];

export const PAST_MISSION_DEFAULT_TAB: PastMissionTabKey = "mine";

export type MissionControlView = {
  activePage: number;
  activeTab: ActiveMissionTabKey;
  pastPage: number;
  pastTab: PastMissionTabKey;
};

export const MISSION_CONTROL_VIEW_STORAGE_KEY = "veydrift:mission-control:view";

export const MISSION_CONTROL_ROUTE_PATH = "/mission-control";

export const MISSION_CONTROL_VIEW_PARAM_KEYS = ["at", "pt", "ap", "pp"] as const;

export function isMissionControlListPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "") === MISSION_CONTROL_ROUTE_PATH;
}

export const ACTIVE_MISSION_TAB_KEYS = new Set<string>(ACTIVE_MISSION_TABS.map((tab) => tab.key));

export const PAST_MISSION_TAB_KEYS = new Set<string>(PAST_MISSION_TABS.map((tab) => tab.key));

export const DEFAULT_MISSION_CONTROL_VIEW: MissionControlView = {
  activePage: 0,
  activeTab: ACTIVE_MISSION_DEFAULT_TAB,
  pastPage: 0,
  pastTab: PAST_MISSION_DEFAULT_TAB,
};

export function clampPageIndex(value: unknown): number {
  const page = Math.trunc(Number(value));
  return Number.isFinite(page) && page > 0 ? page : 0;
}

export function missionControlViewStorage(): Storage | null {
  // Accessing window.sessionStorage can throw in privacy mode / sandboxed iframes, and is undefined
  // under SSR and the test renderer — fall back to defaults in every such case.
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function readPersistedMissionControlView(): MissionControlView {
  const storage = missionControlViewStorage();
  if (!storage) return DEFAULT_MISSION_CONTROL_VIEW;
  try {
    const raw = storage.getItem(MISSION_CONTROL_VIEW_STORAGE_KEY);
    if (!raw) return DEFAULT_MISSION_CONTROL_VIEW;
    const parsed = JSON.parse(raw) as Partial<MissionControlView> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_MISSION_CONTROL_VIEW;
    return {
      activePage: clampPageIndex(parsed.activePage),
      activeTab: ACTIVE_MISSION_TAB_KEYS.has(String(parsed.activeTab))
        ? (parsed.activeTab as ActiveMissionTabKey)
        : ACTIVE_MISSION_DEFAULT_TAB,
      pastPage: clampPageIndex(parsed.pastPage),
      pastTab: PAST_MISSION_TAB_KEYS.has(String(parsed.pastTab))
        ? (parsed.pastTab as PastMissionTabKey)
        : PAST_MISSION_DEFAULT_TAB,
    };
  } catch {
    return DEFAULT_MISSION_CONTROL_VIEW;
  }
}

export let lastMissionControlView: MissionControlView = DEFAULT_MISSION_CONTROL_VIEW;

export function persistMissionControlView(partial: Partial<MissionControlView>): void {
  const next = { ...readPersistedMissionControlView(), ...partial };
  lastMissionControlView = next;
  const storage = missionControlViewStorage();
  if (storage) {
    try {
      storage.setItem(MISSION_CONTROL_VIEW_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Best-effort persistence: ignore quota/security errors.
    }
  }
  // VEY-412 rework: the URL query is the source of truth — it survives browser back, hard reload, and
  // is shareable. sessionStorage / the in-memory mirror are the fallbacks for the in-app
  // "← Mission Control" button, which navigates to bare `/mission-control` (no query).
  writeMissionControlViewToLocation(next);
}

export function parseMissionControlViewParams(query: string): Partial<MissionControlView> {
  const params = new URLSearchParams(query);
  const out: Partial<MissionControlView> = {};
  const activeTab = params.get("at");
  if (activeTab && ACTIVE_MISSION_TAB_KEYS.has(activeTab)) out.activeTab = activeTab as ActiveMissionTabKey;
  const pastTab = params.get("pt");
  if (pastTab && PAST_MISSION_TAB_KEYS.has(pastTab)) out.pastTab = pastTab as PastMissionTabKey;
  if (params.has("ap")) out.activePage = clampPageIndex(params.get("ap"));
  if (params.has("pp")) out.pastPage = clampPageIndex(params.get("pp"));
  return out;
}

export function buildMissionControlViewQuery(view: MissionControlView): string {
  const params = new URLSearchParams();
  if (view.activeTab !== ACTIVE_MISSION_DEFAULT_TAB) params.set("at", view.activeTab);
  if (view.pastTab !== PAST_MISSION_DEFAULT_TAB) params.set("pt", view.pastTab);
  if (view.activePage > 0) params.set("ap", String(view.activePage));
  if (view.pastPage > 0) params.set("pp", String(view.pastPage));
  return params.toString();
}

export function readMissionControlViewFromLocation(): Partial<MissionControlView> | null {
  if (typeof window === "undefined") return null;
  try {
    if (!isMissionControlListPath(window.location.pathname) || !window.location.search) return null;
    const parsed = parseMissionControlViewParams(window.location.search);
    return Object.keys(parsed).length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeMissionControlViewToLocation(view: MissionControlView): void {
  if (typeof window === "undefined") return;
  try {
    if (!isMissionControlListPath(window.location.pathname)) return;
    const params = new URLSearchParams(window.location.search);
    for (const key of MISSION_CONTROL_VIEW_PARAM_KEYS) params.delete(key);
    const viewParams = new URLSearchParams(buildMissionControlViewQuery(view));
    viewParams.forEach((value, key) => params.set(key, value));
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // Best-effort: a sandboxed history (some embeds) can throw on replaceState.
  }
}

export function resolveMissionControlView(): MissionControlView {
  const persisted = readPersistedMissionControlView();
  const base = isDefaultMissionControlView(persisted) ? lastMissionControlView : persisted;
  const fromLocation = readMissionControlViewFromLocation();
  return fromLocation ? { ...base, ...fromLocation } : base;
}

export function isDefaultMissionControlView(view: MissionControlView): boolean {
  return (
    view.activeTab === DEFAULT_MISSION_CONTROL_VIEW.activeTab &&
    view.pastTab === DEFAULT_MISSION_CONTROL_VIEW.pastTab &&
    view.activePage === DEFAULT_MISSION_CONTROL_VIEW.activePage &&
    view.pastPage === DEFAULT_MISSION_CONTROL_VIEW.pastPage
  );
}

export function normalizeMissionNumberSearch(value: string): string {
  return value.replace(/\D+/g, "");
}

export function normalizeMissionControlFilters(filters: Partial<MissionControlFilters>): MissionControlFilters {
  const direction = filters.direction;
  return {
    direction: direction === "outbound" || direction === "returning" ? direction : "",
    missionNumber: normalizeMissionNumberSearch(filters.missionNumber ?? ""),
    missionType: (filters.missionType ?? "").trim(),
    planetId: (filters.planetId ?? "").replace(/\D+/g, "").replace(/^0+(?=\d)/, ""),
  };
}

export function missionPlanetCoordinateKey(coords: Coordinates): string {
  return `${coords.galaxy}:${coords.system}:${coords.position}`;
}

export function missionSystemKeysMissingUniverseArchetypes(
  missions: readonly FleetMissionSummary[],
  planetArchetypesByCoordinate: ReadonlyMap<string, PlanetType> = EMPTY_PLANET_ARCHETYPE_LOOKUP,
): string[] {
  const systemKeys = new Set<string>();
  for (const mission of missions) {
    addMissionReferenceSystemKey(systemKeys, mission.originPlanet, planetArchetypesByCoordinate);
    addMissionReferenceSystemKey(systemKeys, mission.targetPlanet, planetArchetypesByCoordinate);
  }
  return Array.from(systemKeys).sort();
}

export function addMissionReferenceSystemKey(
  systemKeys: Set<string>,
  ref: FleetMissionPlanetReference | null | undefined,
  planetArchetypesByCoordinate: ReadonlyMap<string, PlanetType>,
): void {
  if (!ref || ref.archetype) return;
  const coords = { galaxy: ref.galaxy, position: ref.position, system: ref.system };
  if (planetArchetypesByCoordinate.has(missionPlanetCoordinateKey(coords))) return;
  systemKeys.add(`${ref.galaxy}:${ref.system}`);
}

export function missionTypeLabel(missionType: string): string {
  if (missionType === "AcsAttack") return "Group attack";
  if (missionType === "AcsDefend") return "Group defense";
  if (missionType === "DefenseHold") return "Stationed defense";
  return missionType.replace(/([A-Z])/g, " $1").trim();
}
