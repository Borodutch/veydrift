// Pure logic for the raid-target finder (VEY-KANEO-446).
//
// The finder reuses the public highscore feed — which already exposes every
// occupied planet per player together with tactical intel (raidable loot,
// ship/defense power) and the viewer's attack-protection status — and flattens
// it into a single, sortable/filterable list of raid candidates. It also
// matches the viewer's in-flight fleets so targets that are already being
// raided can be flagged, and surfaces fleets inbound to the viewer's own
// planets for situational awareness.
//
// Everything here is deterministic and free of DOM/preact so it can be unit
// tested in isolation; the page component (RaidTargetFinderPage) wires it to
// fetched data and React-style state.

import { fleetMissionDistance } from "./fleetMissionRules";
import type { Coordinates, PlanetType } from "./types";
import type {
  FleetMissionSummary,
  FleetMissionVisibilityResponse,
  HighscoreEntry,
  HighscorePlanet,
  OnChainResources,
  TacticalUnitBreakdown,
} from "./walletFlow";

export type RaidTargetAlliance = {
  allianceId: string;
  tag: string;
  name: string;
};

export type RaidTargetProtection = {
  // Blocked by score/newbie/bashing protection — i.e. the viewer is not allowed
  // to attack but it is not an alliance relationship.
  isProtected: boolean;
  // Target belongs to the viewer's alliance.
  isSameAlliance: boolean;
  blockedReason: "none" | "bashing_limit" | "score_protection" | "same_alliance";
  blockedReasonLabel: string | null;
  defenderInactive: boolean;
};

export type RaidTargetInbound = {
  // Number of the viewer's own (or joinable) fleets already inbound to this target.
  count: number;
  // Soonest arrival timestamp in milliseconds, or null when none are inbound.
  nextArrivalAtMs: number | null;
};

export type RaidTargetUnitBreakdown = {
  id: number;
  count: number;
  power: number;
};

export type RaidTarget = {
  planetId: string;
  name: string | null;
  coordinates: Coordinates;
  archetype: PlanetType;
  owner: string;
  ownerDisplayName: string | null;
  alliance: RaidTargetAlliance | null;
  // Flight distance from the viewer's active planet, or null when no origin is known.
  distance: number | null;
  // Raidable resource total (metal + crystal + deuterium) as a finite number.
  // This is the ~50% on-chain plunder of `grossLoot`, not the planet's full stockpile.
  loot: number;
  // Full production-accrued public resource total LOOT is plundered from (the figure the
  // planet/universe surface shows). 0 when the backend does not report it. (VEY-KANEO-454)
  grossLoot: number;
  raidableResources: OnChainResources | null;
  combatPower: number;
  shipPower: number;
  shipCount: number;
  shipUnits: RaidTargetUnitBreakdown[];
  combatShipUnits: RaidTargetUnitBreakdown[];
  defensePower: number;
  defenseCount: number;
  defenseUnits: RaidTargetUnitBreakdown[];
  protection: RaidTargetProtection;
  inbound: RaidTargetInbound;
};

export type RaidTargetSortKey = "distance" | "loot" | "combat" | "defense";
export type RaidTargetSortDirection = "asc" | "desc";

export type RaidTargetSort = {
  key: RaidTargetSortKey;
  direction: RaidTargetSortDirection;
};

export type RaidTargetFilters = {
  hideProtected: boolean;
  hideSameAlliance: boolean;
  hideDefended: boolean;
  hideActiveFleet: boolean;
  minLoot: number;
  maxDistance: number | null;
};

export const DEFAULT_RAID_TARGET_SORT: RaidTargetSort = {
  key: "loot",
  direction: "desc",
};

export const DEFAULT_RAID_TARGET_FILTERS: RaidTargetFilters = {
  hideProtected: true,
  hideSameAlliance: true,
  hideDefended: false,
  hideActiveFleet: false,
  minLoot: 0,
  maxDistance: null,
};
export const RAID_TARGET_FINDER_STORAGE_KEY = "veydrift.raidTargetFinder.v1";

const ATTACKABLE_MISSION_TYPES = new Set(["Attack", "AcsAttack"]);

function safeNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function persistedNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
}

function persistedNullableNumber(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
}

export function normalizeRaidTargetFilters(value: unknown): RaidTargetFilters {
  if (!value || typeof value !== "object") return DEFAULT_RAID_TARGET_FILTERS;
  const candidate = value as Partial<Record<keyof RaidTargetFilters, unknown>>;
  return {
    hideProtected: typeof candidate.hideProtected === "boolean"
      ? candidate.hideProtected
      : DEFAULT_RAID_TARGET_FILTERS.hideProtected,
    hideSameAlliance: typeof candidate.hideSameAlliance === "boolean"
      ? candidate.hideSameAlliance
      : DEFAULT_RAID_TARGET_FILTERS.hideSameAlliance,
    hideDefended: typeof candidate.hideDefended === "boolean"
      ? candidate.hideDefended
      : DEFAULT_RAID_TARGET_FILTERS.hideDefended,
    hideActiveFleet: typeof candidate.hideActiveFleet === "boolean"
      ? candidate.hideActiveFleet
      : DEFAULT_RAID_TARGET_FILTERS.hideActiveFleet,
    minLoot: persistedNumber(candidate.minLoot, DEFAULT_RAID_TARGET_FILTERS.minLoot),
    maxDistance: persistedNullableNumber(candidate.maxDistance, DEFAULT_RAID_TARGET_FILTERS.maxDistance),
  };
}

export function normalizeRaidTargetSort(value: unknown): RaidTargetSort {
  if (!value || typeof value !== "object") return DEFAULT_RAID_TARGET_SORT;
  const candidate = value as Partial<Record<keyof RaidTargetSort, unknown>>;
  const key = candidate.key;
  const direction = candidate.direction;
  return {
    key: key === "distance" || key === "loot" || key === "combat" || key === "defense"
      ? key
      : DEFAULT_RAID_TARGET_SORT.key,
    direction: direction === "asc" || direction === "desc"
      ? direction
      : DEFAULT_RAID_TARGET_SORT.direction,
  };
}

export function hasActiveAlliance(allianceId: string | null | undefined): boolean {
  return Boolean(allianceId && allianceId !== "0");
}

export type RaidTargetPersistedSettings = {
  filters: RaidTargetFilters;
  sort: RaidTargetSort;
};

export function readPersistedRaidTargetSettings(): RaidTargetPersistedSettings {
  const fallback = { filters: DEFAULT_RAID_TARGET_FILTERS, sort: DEFAULT_RAID_TARGET_SORT };
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(RAID_TARGET_FINDER_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { filters?: unknown; sort?: unknown };
    return {
      filters: normalizeRaidTargetFilters(parsed.filters),
      sort: normalizeRaidTargetSort(parsed.sort),
    };
  } catch {
    return fallback;
  }
}

export function persistRaidTargetSettings(settings: RaidTargetPersistedSettings) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(RAID_TARGET_FINDER_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing/storage quota failures should not break scouting.
  }
}

function unitBreakdown(units: TacticalUnitBreakdown[] | null | undefined): RaidTargetUnitBreakdown[] {
  if (!units || units.length === 0) return [];
  return units
    .map((unit) => ({
      id: unit.id,
      count: Math.max(0, Math.trunc(unit.count)),
      power: safeNumber(unit.power),
    }))
    .filter((unit) => unit.count > 0);
}

function timestampToMs(value: string | number | null | undefined): number | null {
  const seconds = safeNumber(value);
  if (seconds <= 0) return null;
  // Mission timestamps are unix seconds; tolerate millisecond values too.
  return seconds > 1e12 ? Math.trunc(seconds) : Math.trunc(seconds * 1_000);
}

function classifyProtection(entry: HighscoreEntry): RaidTargetProtection {
  const protection = entry.attackProtection ?? null;
  const blockedReason = protection?.blockedReason ?? "none";
  const isSameAlliance = blockedReason === "same_alliance";
  const isProtected = Boolean(
    protection
      && !protection.allowed
      && blockedReason !== "none"
      && blockedReason !== "same_alliance",
  );
  return {
    isProtected,
    isSameAlliance,
    blockedReason,
    blockedReasonLabel: protection?.blockedReasonLabel ?? null,
    defenderInactive: protection?.defenderInactive === true,
  };
}

/**
 * Group the viewer's in-flight attacking fleets (their own outgoing attacks and
 * joinable alliance attacks) by the target planet they are heading toward. Used
 * to flag finder rows for planets that already have fleets inbound.
 */
export function inboundFleetsByTarget(
  fleetVisibility: FleetMissionVisibilityResponse | undefined,
): Map<string, FleetMissionSummary[]> {
  const grouped = new Map<string, FleetMissionSummary[]>();
  if (!fleetVisibility) return grouped;

  const candidates = [
    ...fleetVisibility.outgoing,
    ...fleetVisibility.joinableAttacks,
  ];

  for (const mission of candidates) {
    if (!ATTACKABLE_MISSION_TYPES.has(mission.missionType)) continue;
    if (mission.status !== "Outbound") continue;
    const targetId = mission.targetPlanetId;
    if (!targetId) continue;
    const bucket = grouped.get(targetId);
    if (bucket) {
      bucket.push(mission);
    } else {
      grouped.set(targetId, [mission]);
    }
  }

  return grouped;
}

function inboundSummary(missions: FleetMissionSummary[] | undefined): RaidTargetInbound {
  if (!missions || missions.length === 0) {
    return { count: 0, nextArrivalAtMs: null };
  }
  let nextArrivalAtMs: number | null = null;
  for (const mission of missions) {
    const arrival = timestampToMs(mission.arrivalAt);
    if (arrival === null) continue;
    if (nextArrivalAtMs === null || arrival < nextArrivalAtMs) {
      nextArrivalAtMs = arrival;
    }
  }
  return { count: missions.length, nextArrivalAtMs };
}

function dedupePlanets(entry: HighscoreEntry): HighscorePlanet[] {
  const planets = entry.planets && entry.planets.length > 0
    ? entry.planets
    : entry.homePlanet
      ? [entry.homePlanet]
      : [];
  const seen = new Set<string>();
  const unique: HighscorePlanet[] = [];
  for (const planet of planets) {
    if (seen.has(planet.planetId)) continue;
    seen.add(planet.planetId);
    unique.push(planet);
  }
  return unique;
}

/**
 * Flatten highscore entries into a flat list of raid candidates, excluding the
 * viewer's own planets. Distance, loot, combat and protection are precomputed so
 * sorting/filtering stay cheap.
 */
export function buildRaidTargets({
  entries,
  origin,
  currentWallet,
  fleetVisibility,
}: {
  entries: HighscoreEntry[];
  origin?: Coordinates | null | undefined;
  currentWallet?: string | null | undefined;
  fleetVisibility?: FleetMissionVisibilityResponse | undefined;
}): RaidTarget[] {
  const normalizedWallet = currentWallet ? currentWallet.toLowerCase() : null;
  const inboundByTarget = inboundFleetsByTarget(fleetVisibility);
  const targets: RaidTarget[] = [];

  for (const entry of entries) {
    if (normalizedWallet && entry.wallet.toLowerCase() === normalizedWallet) continue;
    const protection = classifyProtection(entry);
    const alliance = entry.alliance ?? null;

    for (const planet of dedupePlanets(entry)) {
      const tactical = planet.tactical;
      targets.push({
        planetId: planet.planetId,
        name: planet.name,
        coordinates: planet.coordinates,
        archetype: planet.archetype,
        owner: entry.wallet,
        ownerDisplayName: entry.displayName ?? null,
        alliance,
        distance: origin ? fleetMissionDistance(origin, planet.coordinates) : null,
        loot: safeNumber(tactical?.raidableResourceTotal),
        grossLoot: safeNumber(tactical?.grossResourceTotal),
        raidableResources: tactical?.raidableResources ?? null,
        combatPower: safeNumber(tactical?.combatPower),
        shipPower: safeNumber(tactical?.ships.power),
        shipCount: tactical?.ships.count ?? 0,
        shipUnits: unitBreakdown(tactical?.ships.units),
        combatShipUnits: unitBreakdown(tactical?.combatShips?.units),
        defensePower: safeNumber(tactical?.defenses.power),
        defenseCount: tactical?.defenses.count ?? 0,
        defenseUnits: unitBreakdown(tactical?.defenses.units),
        protection,
        inbound: inboundSummary(inboundByTarget.get(planet.planetId)),
      });
    }
  }

  return targets;
}

export function filterRaidTargets(
  targets: RaidTarget[],
  filters: RaidTargetFilters,
  options: {
    hasActiveFleetActivity?: ((target: RaidTarget) => boolean) | undefined;
  } = {},
): RaidTarget[] {
  return targets.filter((target) => {
    if (filters.hideProtected && target.protection.isProtected) return false;
    if (filters.hideSameAlliance && target.protection.isSameAlliance) return false;
    if (filters.hideDefended && target.combatPower > 0) return false;
    if (filters.hideActiveFleet && options.hasActiveFleetActivity?.(target)) return false;
    if (target.loot < filters.minLoot) return false;
    if (
      filters.maxDistance !== null
      && target.distance !== null
      && target.distance > filters.maxDistance
    ) {
      return false;
    }
    return true;
  });
}

function sortValue(target: RaidTarget, key: RaidTargetSortKey): number {
  switch (key) {
    case "distance":
      // Targets with unknown distance sort last regardless of direction.
      return target.distance === null ? Number.POSITIVE_INFINITY : target.distance;
    case "loot":
      return target.loot;
    case "combat":
      return target.combatPower;
    case "defense":
      return target.defensePower;
  }
}

export function sortRaidTargets(
  targets: RaidTarget[],
  sort: RaidTargetSort,
): RaidTarget[] {
  const directionFactor = sort.direction === "asc" ? 1 : -1;
  return [...targets].sort((left, right) => {
    const leftValue = sortValue(left, sort.key);
    const rightValue = sortValue(right, sort.key);

    // Unknown distance always sinks to the bottom so it never crowds the top of
    // an ascending "closest first" sort.
    if (leftValue === Number.POSITIVE_INFINITY && rightValue !== Number.POSITIVE_INFINITY) return 1;
    if (rightValue === Number.POSITIVE_INFINITY && leftValue !== Number.POSITIVE_INFINITY) return -1;

    if (leftValue !== rightValue) return (leftValue - rightValue) * directionFactor;

    // Stable, deterministic tiebreakers: loot desc, then coordinates.
    if (left.loot !== right.loot) return right.loot - left.loot;
    return compareCoordinates(left.coordinates, right.coordinates);
  });
}

function compareCoordinates(left: Coordinates, right: Coordinates): number {
  if (left.galaxy !== right.galaxy) return left.galaxy - right.galaxy;
  if (left.system !== right.system) return left.system - right.system;
  return left.position - right.position;
}

export function prepareRaidTargets({
  entries,
  origin,
  currentWallet,
  fleetVisibility,
  filters,
  sort,
  hasActiveFleetActivity,
}: {
  entries: HighscoreEntry[];
  origin?: Coordinates | null | undefined;
  currentWallet?: string | null | undefined;
  fleetVisibility?: FleetMissionVisibilityResponse | undefined;
  filters: RaidTargetFilters;
  sort: RaidTargetSort;
  hasActiveFleetActivity?: ((target: RaidTarget) => boolean) | undefined;
}): RaidTarget[] {
  const targets = buildRaidTargets({ entries, origin, currentWallet, fleetVisibility });
  return sortRaidTargets(filterRaidTargets(targets, filters, { hasActiveFleetActivity }), sort);
}

export type RaidTargetTotals = {
  total: number;
  visible: number;
  protected: number;
  sameAlliance: number;
};

export function raidTargetTotals(
  allTargets: RaidTarget[],
  visibleTargets: RaidTarget[],
): RaidTargetTotals {
  let protectedCount = 0;
  let sameAllianceCount = 0;
  for (const target of allTargets) {
    if (target.protection.isProtected) protectedCount += 1;
    if (target.protection.isSameAlliance) sameAllianceCount += 1;
  }
  return {
    total: allTargets.length,
    visible: visibleTargets.length,
    protected: protectedCount,
    sameAlliance: sameAllianceCount,
  };
}

export type IncomingThreat = {
  missionId: string;
  attacker: string;
  attackerDisplayName: string | null;
  originCoordinates: string | null;
  targetCoordinates: string | null;
  missionType: string;
  arrivalAtMs: number | null;
};

/**
 * Fleets inbound to the viewer's own planets (hostile attacks). Surfaced as a
 * situational-awareness banner so the raider knows what is coming at them while
 * they pick targets. Sorted by soonest arrival.
 */
export function incomingThreats(
  fleetVisibility: FleetMissionVisibilityResponse | undefined,
): IncomingThreat[] {
  if (!fleetVisibility) return [];
  return fleetVisibility.incoming
    .filter((mission) => mission.status === "Outbound")
    .map((mission) => ({
      missionId: mission.missionId,
      attacker: mission.owner,
      attackerDisplayName: mission.originPlanet?.ownerDisplayName ?? null,
      originCoordinates: mission.originPlanet?.coordinates ?? null,
      targetCoordinates: mission.targetPlanet?.coordinates ?? null,
      missionType: mission.missionType,
      arrivalAtMs: timestampToMs(mission.arrivalAt),
    }))
    .sort((left, right) => {
      const leftArrival = left.arrivalAtMs ?? Number.POSITIVE_INFINITY;
      const rightArrival = right.arrivalAtMs ?? Number.POSITIVE_INFINITY;
      return leftArrival - rightArrival;
    });
}
