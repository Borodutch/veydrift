import { useState, useEffect, useMemo, useRef } from "preact/hooks";
import type { Planet, Coordinates } from "../types";
import {
  DEFAULT_MISSION_SPEED_PERCENT,
  type FleetDriveLevels,
  fleetMissionAvailableCargoCapacity,
  fleetMissionDistance,
  fleetMissionFuelCost,
  fleetMissionShipCount,
  fleetMissionTravelSeconds,
} from "../fleetMissionRules";
import type { MissionShips } from "../galaxyActions";
import { GAME_UNAVAILABLE_MESSAGE } from "../gameUnavailable";
import {
  formatPlanetType,
  GALAXY_COUNT,
  SYSTEM_COUNT,
  POSITION_COUNT,
  mergePlanetAtCoordinates,
  planetsFromSystemResponse,
  planetTypeFromTemperature,
  type ApiSystemResponse,
} from "../data/mockUniverse";
import { playableApiUrl } from "../runtimeConfig";
import { shortAddress } from "../walletFlow";
import type { ChainDefenseState, ChainShipyardState } from "../walletFlow";
import { formatUserTimestamp } from "../timestampFormat";
import {
  galaxyActionsForSlot,
  type GalaxyAction,
} from "../galaxyActions";
import {
  commitCoordinateDraft,
  coordinateDraftAfterExternalValueChange,
  sanitizeCoordinateDraft,
} from "../galaxyCoordinateInput";
import { PlanetImageSkeleton } from "./PlanetImageSkeleton";
import { InlineSyncIndicator } from "./VeydriftLoader";
import { GalaxyRowsSkeleton } from "./LoadingSkeletons";
import { InlineStateNotice } from "./InlineStateNotice";
import { WatchablePlanetRow, type PlanetMetaItem } from "./WatchablePlanetRow";
import { galaxyActionIcon } from "./GalaxyActionIcon";

const SMALL_CARGO_SHIP_ID = 0;
const GALAXY_SYSTEM_CACHE_TTL_MS = 2 * 60 * 1_000;
const defaultMissionShips = (): Partial<MissionShips> => ({ smallCargo: 1 });
type GalaxySystemCacheEntry = {
  planets: Planet[];
  storedAt: number;
};

const galaxySystemCache = new Map<string, GalaxySystemCacheEntry>();

export function formatAllianceLabel(alliance: Planet["alliance"]): string {
  if (!alliance) return "";
  return alliance.tag ? `[${alliance.tag}] ${alliance.name}` : alliance.name;
}

export function formatGalaxyCommanderLabel(planet: Planet): string {
  if (planet.migrationReservation) return planet.migrationReservation.label || "Quantum-unstable planet";
  if (planet.occupiedBy?.ownerDisplayName) return planet.occupiedBy.ownerDisplayName;
  if (planet.ownerId) return shortAddress(planet.ownerId);
  return "Unclaimed";
}

export function formatGalaxyAllianceIdentityLabel(alliance: Planet["alliance"]): string {
  if (!alliance) return "";
  return alliance.tag ? `[${alliance.tag}]` : alliance.name;
}

type MissionResources = {
  metal?: number;
  crystal?: number;
  deuterium?: number;
};

export type GalaxyMissionPlanner = {
  fleetSlots?: {
    active: number;
    limit: number;
  } | undefined;
  resources?: MissionResources | undefined;
  missionShips?: Partial<MissionShips> | undefined;
  driveLevels?: FleetDriveLevels | undefined;
  speedPercent?: number | undefined;
  universeSpeed?: number | undefined;
  ships?: Array<{ id: number; count: number }> | undefined;
  now?: number | undefined;
};

export type GalaxyMissionPreview = {
  blockedReason?: string | undefined;
  cargoCapacity: number;
  fleetSlots: {
    active: number;
    limit: number;
  };
  fuelCost: number;
  arrivalAt: number;
  returnAt: number;
};

export type AttackProtectionStatus = {
  allowed: boolean;
  blockedReason: "none" | "bashing_limit" | "score_protection" | "same_alliance";
  blockedReasonLabel: string | null;
  targetPlanetId: string;
  relation?: "peer" | "stronger" | "weaker";
  defenderHonorStatus?: "neutral" | "honorable" | "bandit";
  plunderBps?: number;
  defenderInactive?: boolean;
  riftProtectionBypass?: boolean;
  scoreComparison?: {
    attackerScore: string;
    defenderScore: string;
  };
  transportAllowed?: boolean;
  transportBlockReason?: "none" | "own_planet" | "same_alliance" | "not_allied";
  transportBlockReasonLabel?: string | null;
  atWar?: boolean;
  targetAlliance?: {
    allianceId: string;
    tag: string;
    name: string;
  } | null;
};

export type GalaxyActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

interface Props {
  account?: string | undefined;
  actionState?: GalaxyActionState | undefined;
  galaxy: number;
  system: number;
  apiBaseUrl?: string | undefined;
  homeCoords?: Coordinates | undefined;
  homePlanetId?: string | null | undefined;
  homePlanet?: Planet | undefined;
  ownedPlanets?: readonly Planet[] | undefined;
  defenseState?: ChainDefenseState | null | undefined;
  shipyardState?: ChainShipyardState | null | undefined;
  onAction?: ((action: GalaxyAction, target: Planet | undefined, coords: Coordinates) => void) | undefined;
  onSelectAlliance?: ((allianceId: string) => void) | undefined;
  onSelectPlayer?: ((wallet: string) => void) | undefined;
  onToggleWatchPlanet?: ((planetId: string, watched: boolean) => void) | undefined;
  onSelectPlanet: (coords: Coordinates) => void;
  onSelectMoon?: ((coords: Coordinates) => void) | undefined;
  onNavigate: (galaxy: number, system: number) => void;
  transactionUnavailableReason?: string | undefined;
  watchedPlanetIds?: readonly string[] | undefined;
  watchBusyPlanetId?: string | undefined;
}

export function GalaxyView({
  account,
  actionState = { status: "idle" },
  galaxy,
  system,
  apiBaseUrl = playableApiUrl,
  homeCoords,
  homePlanetId,
  homePlanet,
  ownedPlanets = [],
  defenseState = null,
  shipyardState = null,
  onAction,
  onSelectAlliance,
  onSelectPlayer,
  onToggleWatchPlanet,
  onSelectPlanet,
  onSelectMoon,
  onNavigate,
  transactionUnavailableReason,
  watchedPlanetIds = [],
  watchBusyPlanetId,
}: Props) {
  const currentSystemKey = galaxySystemKey(galaxy, system);
  const cachedSystem = cachedGalaxySystemPlanets(apiBaseUrl, galaxy, system);
  const [systemPlanets, setSystemPlanets] = useState<Planet[]>(() => cachedSystem ?? []);
  const [attackProtection, setAttackProtection] = useState<Record<string, AttackProtectionStatus>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [reloadNonce, setReloadNonce] = useState(0);
  const [loadedSystemKey, setLoadedSystemKey] = useState<string | undefined>(
    () => cachedSystem ? currentSystemKey : undefined
  );
  const loadedSystemKeyRef = useRef<string | undefined>();
  const homeCoordsInSystem = homeCoords?.galaxy === galaxy && homeCoords.system === system
    ? homeCoords
    : undefined;
  const homePlanetOverride = homePlanet?.galaxy === galaxy && homePlanet.system === system
    ? homePlanet
    : undefined;
  const ownedPlanetsInSystem = useMemo(
    () => ownedPlanets.filter((planet) => planet.galaxy === galaxy && planet.system === system),
    [galaxy, ownedPlanets, system]
  );
  const planets = useMemo(
    () => withOwnedPlanetNames(withHomePlanet(systemPlanets, homePlanetOverride), ownedPlanetsInSystem),
    [homePlanetOverride, ownedPlanetsInSystem, systemPlanets]
  );
  const galaxySystemUrl = useMemo(
    () => galaxySystemRequestUrl(apiBaseUrl, galaxy, system),
    [apiBaseUrl, galaxy, system]
  );

  useEffect(() => {
    loadedSystemKeyRef.current = loadedSystemKey;
  }, [loadedSystemKey]);

  useEffect(() => {
    const abortController = new AbortController();
    const canPreserveCurrentSystem = loadedSystemKeyRef.current === currentSystemKey;
    const cachedPlanets = cachedGalaxySystemPlanets(apiBaseUrl, galaxy, system);

    if (cachedPlanets && !canPreserveCurrentSystem) {
      setSystemPlanets(cachedPlanets);
      setLoadedSystemKey(currentSystemKey);
    }

    setLoading(true);
    setLoadError(undefined);

    fetch(galaxySystemUrl, {
      headers: { accept: "application/json" },
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Universe request failed with ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        const nextPlanets = rememberGalaxySystemPayload(apiBaseUrl, galaxy, system, payload);
        setSystemPlanets(nextPlanets);
        setLoadedSystemKey(currentSystemKey);
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.error(error);
          if (!canPreserveCurrentSystem) {
            setSystemPlanets(planetsForFailedGalaxyLoad());
            setLoadedSystemKey(undefined);
          }
          setLoadError(systemLoadErrorLabel(error));
        }
      })
      .finally(() => {
        if (!abortController.signal.aborted) setLoading(false);
      });

    return () => abortController.abort();
  }, [apiBaseUrl, currentSystemKey, galaxy, galaxySystemUrl, reloadNonce, system]);

  useEffect(() => {
    const occupiedTargets = planets
      .filter((planet) => planet.occupiedBy && account && !sameCoordinates(homeCoords, planet))
      .map((planet) => planet.occupiedBy?.planetId)
      .filter((planetId): planetId is string => Boolean(planetId));

    if (occupiedTargets.length === 0) {
      setAttackProtection({});
      return;
    }

    const abortController = new AbortController();
    const apiRoot = apiBaseUrl.replace(/\/+$/, "");
    Promise.all(
      occupiedTargets.map((planetId) =>
        fetch(`${apiRoot}/wallet/${account}/attack-protection?targetPlanetId=${planetId}`, {
          headers: { accept: "application/json" },
          signal: abortController.signal,
        }).then((response) => {
          if (!response.ok) throw new Error(`Attack protection request failed with ${response.status}`);
          return response.json() as Promise<AttackProtectionStatus>;
        })
      )
    )
      .then((statuses) => {
        if (!abortController.signal.aborted) {
          setAttackProtection(Object.fromEntries(statuses.map((status) => [status.targetPlanetId, status])));
        }
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.error(error);
          setAttackProtection({});
        }
      });

    return () => abortController.abort();
  }, [account, apiBaseUrl, homeCoords?.galaxy, homeCoords?.position, homeCoords?.system, planets]);

  const handlePrevSystem = () => {
    let newSystem = system - 1;
    let newGalaxy = galaxy;
    if (newSystem < 1) {
      newSystem = SYSTEM_COUNT;
      newGalaxy = galaxy - 1;
      if (newGalaxy < 1) newGalaxy = GALAXY_COUNT;
    }
    onNavigate(newGalaxy, newSystem);
  };

  const handleNextSystem = () => {
    let newSystem = system + 1;
    let newGalaxy = galaxy;
    if (newSystem > SYSTEM_COUNT) {
      newSystem = 1;
      newGalaxy = galaxy + 1;
      if (newGalaxy > GALAXY_COUNT) newGalaxy = 1;
    }
    onNavigate(newGalaxy, newSystem);
  };

  const handleGalaxyCommit = (value: number) => {
    onNavigate(value, system);
  };

  const handleSystemCommit = (value: number) => {
    onNavigate(galaxy, value);
  };

  const planetByPosition = new Map<number, Planet>();
  for (const p of planets) planetByPosition.set(p.position, p);

  const positions = Array.from({ length: POSITION_COUNT }, (_, i) => i + 1);
  const hasCurrentSystemData = loadedSystemKey === currentSystemKey;
  const showInitialGalaxyLoader = shouldShowGalaxyInitialLoader({ hasCurrentSystemData, loading });
  const showGalaxyRows = shouldShowGalaxyRows({ hasCurrentSystemData });
  const showInitialLoadError = Boolean(loadError && !hasCurrentSystemData && !loading);
  const loadErrorPresentation = galaxyLoadErrorPresentation({ hasCurrentSystemData, loadError });

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white">Galaxy</h2>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-white/10 bg-[#101624] p-1.5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset]">
          <button
            onClick={handlePrevSystem}
            className="h-11 rounded border border-white/15 bg-white/8 px-3 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white sm:h-9"
          >
            ← Prev
          </button>

          <CoordinateInput
            label="Galaxy"
            max={GALAXY_COUNT}
            onCommit={handleGalaxyCommit}
            value={galaxy}
          />

          <CoordinateInput
            label="System"
            max={SYSTEM_COUNT}
            onCommit={handleSystemCommit}
            value={system}
          />

          <button
            onClick={handleNextSystem}
            className="h-11 rounded border border-white/15 bg-white/8 px-3 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white sm:h-9"
          >
            Next →
          </button>
        </div>
      </div>

      <div className="grid gap-1.5 rounded-lg border border-white/10 bg-[#101624] p-2">
        {actionState.status !== "idle" ? (
          <InlineStateNotice
            blocking={actionState.status === "error"}
            className="notice-enter text-xs"
            tone={actionState.status === "error" ? "error" : actionState.status === "success" ? "success" : "info"}
          >
            {actionState.label}
          </InlineStateNotice>
        ) : null}
        <div className="grid gap-1">
          {showInitialGalaxyLoader ? <GalaxyRowsSkeleton /> : null}
          {loading && hasCurrentSystemData ? <InlineSyncIndicator label="Refreshing galaxy" /> : null}

          {showInitialLoadError ? (
            <InlineStateNotice
              blocking={loadErrorPresentation?.blocking}
              title={loadErrorPresentation?.title}
              tone="error"
            >
              <p>{loadErrorPresentation?.message}</p>
              <button
                className="mt-2 h-9 rounded border border-white/15 px-3 text-xs font-semibold text-slate-200 transition hover:border-white/25 hover:text-white"
                onClick={() => setReloadNonce((value) => value + 1)}
                type="button"
              >
                Retry system load
              </button>
            </InlineStateNotice>
          ) : null}

          {loadError && hasCurrentSystemData ? (
            <InlineStateNotice title={loadErrorPresentation?.title}>
              {loadErrorPresentation?.message}
            </InlineStateNotice>
          ) : null}

          {showGalaxyRows &&
            positions.map((pos) => {
              const planet = planetByPosition.get(pos);
              const isHome = planet ? sameCoordinates(homeCoords, planet) : false;
              return (
                <GalaxySlot
                  galaxy={galaxy}
                  isHome={isHome}
                  key={pos}
                  account={account}
                  actionState={actionState}
                  onSelectPlanet={onSelectPlanet}
                  onSelectMoon={onSelectMoon}
                  onSelectAlliance={onSelectAlliance}
                  onSelectPlayer={onSelectPlayer}
                  onToggleWatchPlanet={onToggleWatchPlanet}
                  onAction={onAction}
                  attackProtection={planet?.occupiedBy ? attackProtection[planet.occupiedBy.planetId] : undefined}
                  homeCoords={homeCoordsInSystem}
                  homePlanetId={homePlanetId}
                  planet={planet}
                  position={pos}
                  defenseState={defenseState}
                  shipyardState={shipyardState}
                  system={system}
                  transactionUnavailableReason={transactionUnavailableReason}
                  watchedPlanetIds={watchedPlanetIds}
                  watchBusyPlanetId={watchBusyPlanetId}
                />
              );
            })}
        </div>
      </div>

    </div>
  );
}

function CoordinateInput({
  label,
  value,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const focusedRef = useRef(false);
  const skipBlurCommitRef = useRef(false);

  useEffect(() => {
    setDraft((currentDraft) => coordinateDraftAfterExternalValueChange(currentDraft, value, focusedRef.current));
  }, [value]);

  const commitDraft = () => {
    focusedRef.current = false;

    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      setDraft(String(value));
      return;
    }

    const commit = commitCoordinateDraft(draft, value, max);
    setDraft(commit.draft);
    if (commit.value !== null) onCommit(commit.value);
  };

  return (
    <label className="flex h-9 items-center gap-2 rounded border border-white/15 bg-[#070913] px-2">
      <span className="text-[11px] font-medium uppercase text-slate-500">{label}</span>
      <input
        aria-label={label}
        inputMode="numeric"
        maxLength={String(max).length}
        onBlur={commitDraft}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onInput={(event) => setDraft(sanitizeCoordinateDraft((event.currentTarget as HTMLInputElement).value))}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            (event.currentTarget as HTMLInputElement).blur();
          }
          if (event.key === "Escape") {
            skipBlurCommitRef.current = true;
            setDraft(String(value));
            (event.currentTarget as HTMLInputElement).blur();
          }
        }}
        pattern="[0-9]*"
        value={draft}
        className="h-10 w-12 rounded border border-white/10 bg-[#101624] px-2 text-center font-mono text-sm font-semibold text-white outline-none [color-scheme:dark] focus:border-signal/50 sm:h-7"
      />
    </label>
  );
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function galaxySystemKey(galaxy: number, system: number): string {
  return `${galaxy}:${system}`;
}

export function galaxySystemRequestUrl(apiBaseUrl: string, galaxy: number, system: number): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}/universe/galaxies/${galaxy}/systems/${system}`;
}

export function planetsForFailedGalaxyLoad(): Planet[] {
  return [];
}

export function rememberGalaxySystemPayload(
  apiBaseUrl: string,
  galaxy: number,
  system: number,
  payload: ApiSystemResponse,
  now = Date.now()
): Planet[] {
  const planets = planetsFromSystemResponse(payload);
  galaxySystemCache.set(galaxySystemCacheKey(apiBaseUrl, galaxy, system), {
    planets,
    storedAt: now,
  });
  return planets;
}

export function cachedGalaxySystemPlanets(
  apiBaseUrl: string,
  galaxy: number,
  system: number,
  now = Date.now()
): Planet[] | undefined {
  const key = galaxySystemCacheKey(apiBaseUrl, galaxy, system);
  const entry = galaxySystemCache.get(key);
  if (!entry) return undefined;
  if (now - entry.storedAt > GALAXY_SYSTEM_CACHE_TTL_MS) {
    galaxySystemCache.delete(key);
    return undefined;
  }
  return entry.planets;
}

export function clearGalaxySystemCache(): void {
  galaxySystemCache.clear();
}

export function shouldShowGalaxyInitialLoader({
  hasCurrentSystemData,
  loading,
}: {
  hasCurrentSystemData: boolean;
  loading: boolean;
}): boolean {
  return loading && !hasCurrentSystemData;
}

export function shouldShowGalaxyRows({
  hasCurrentSystemData,
}: {
  hasCurrentSystemData: boolean;
}): boolean {
  return hasCurrentSystemData;
}

export function galaxyLoadErrorPresentation({
  hasCurrentSystemData,
  loadError,
}: {
  hasCurrentSystemData: boolean;
  loadError: string | undefined;
}): { blocking: boolean; message: string; title: string } | null {
  if (!loadError) return null;
  return hasCurrentSystemData
    ? {
        blocking: false,
        message: "Showing the last loaded system rows. Refresh to try again.",
        title: "Galaxy refresh delayed",
      }
    : {
        blocking: true,
        message: "Retry to load this system.",
        title: "Galaxy system unavailable",
      };
}

export function systemLoadErrorLabel(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "The universe API request was cancelled.";
  if (error instanceof TypeError) return GAME_UNAVAILABLE_MESSAGE;
  if (error instanceof Error && /\b5\d\d\b/.test(error.message)) return GAME_UNAVAILABLE_MESSAGE;
  return error instanceof Error ? error.message : "The universe API request failed.";
}

function galaxySystemCacheKey(apiBaseUrl: string, galaxy: number, system: number): string {
  return galaxySystemRequestUrl(apiBaseUrl, galaxy, system);
}

export function formatGalaxyHeatLabel(temperature: Planet["temperature"]): string {
  const orbitalTemperature = (temperature.min + temperature.max) / 2;
  return formatPlanetType(planetTypeFromTemperature(orbitalTemperature));
}

export function estimateGalaxyMissionPreview({
  homeCoords,
  now = Date.now(),
  planner,
  target,
}: {
  homeCoords: Coordinates | undefined;
  now?: number;
  planner: GalaxyMissionPlanner | undefined;
  target: Coordinates;
}): GalaxyMissionPreview | undefined {
  if (!homeCoords || !planner) return undefined;
  const fleetSlots = planner.fleetSlots ?? { active: 0, limit: 1 };
  const smallCargoCount = planner.ships?.find((ship) => ship.id === SMALL_CARGO_SHIP_ID)?.count ?? 0;
  const missionShips = planner.missionShips ?? defaultMissionShips();
  const missionShipCount = fleetMissionShipCount(missionShips);
  const distance = fleetMissionDistance(homeCoords, target);
  const speedPercent = planner.speedPercent ?? DEFAULT_MISSION_SPEED_PERCENT;
  const travelSeconds = fleetMissionTravelSeconds(distance, missionShips, planner.driveLevels, speedPercent, planner.universeSpeed);
  const fuelCost = fleetMissionFuelCost(missionShips, distance, planner.driveLevels, speedPercent);
  const arrivalAt = now + travelSeconds * 1_000;
  const returnAt = arrivalAt + travelSeconds * 1_000;
  const cargoCapacity = fleetMissionAvailableCargoCapacity(missionShips, distance, planner.driveLevels, speedPercent);
  let blockedReason: string | undefined;

  if (sameCoordinateValues(homeCoords, target)) {
    blockedReason = "Origin planet";
  } else if (fleetSlots.active >= fleetSlots.limit) {
    blockedReason = "No fleet slots open — research Computer Technology for more";
  } else if (missionShipCount <= 0) {
    blockedReason = "No mission ships selected";
  } else if (smallCargoCount < 1) {
    blockedReason = "No Small Cargo available";
  } else if ((planner.resources?.deuterium ?? 0) < fuelCost) {
    blockedReason = `Need ${fuelCost.toLocaleString()} deuterium`;
  }

  return {
    blockedReason,
    cargoCapacity,
    fleetSlots,
    fuelCost,
    arrivalAt,
    returnAt,
  };
}

export function galaxyMissionTravelSeconds(origin: Coordinates, target: Coordinates): number {
  return fleetMissionTravelSeconds(fleetMissionDistance(origin, target), defaultMissionShips());
}

export function galaxyMissionFuelCost(origin: Coordinates, target: Coordinates, shipCount: number): number {
  const ships = { smallCargo: Math.max(0, Math.trunc(shipCount)) };
  return fleetMissionFuelCost(ships, fleetMissionDistance(origin, target));
}

function GalaxySlot({
  account,
  actionState,
  galaxy,
  system,
  position,
  planet,
  homeCoords,
  homePlanetId,
  isHome,
  defenseState,
  shipyardState,
  onAction,
  attackProtection,
  onSelectPlanet,
  onSelectMoon,
  onSelectAlliance,
  onSelectPlayer,
  onToggleWatchPlanet,
  transactionUnavailableReason,
  watchedPlanetIds,
  watchBusyPlanetId,
}: {
  account: string | undefined;
  actionState: GalaxyActionState;
  galaxy: number;
  system: number;
  position: number;
  planet: Planet | undefined;
  homeCoords: Coordinates | undefined;
  homePlanetId: string | null | undefined;
  isHome: boolean;
  defenseState: ChainDefenseState | null;
  shipyardState: ChainShipyardState | null;
  onAction: ((action: GalaxyAction, target: Planet | undefined, coords: Coordinates) => void) | undefined;
  attackProtection: AttackProtectionStatus | undefined;
  onSelectPlanet: (coords: Coordinates) => void;
  onSelectMoon?: ((coords: Coordinates) => void) | undefined;
  onSelectAlliance: ((allianceId: string) => void) | undefined;
  onSelectPlayer: ((wallet: string) => void) | undefined;
  onToggleWatchPlanet: ((planetId: string, watched: boolean) => void) | undefined;
  transactionUnavailableReason: string | undefined;
  watchedPlanetIds: readonly string[];
  watchBusyPlanetId: string | undefined;
}) {
  const isPendingHomePlanet = !planet && homeCoords?.position === position;
  const coords = { galaxy, system, position };
  const actions = galaxyActionsForSlot({
    account,
    attackProtection,
    homePlanetId,
    isOrigin: isHome,
    planet,
    defenseState,
    shipyardState,
  });

  if (!planet) {
    if (isPendingHomePlanet) {
      return (
        <div className="grid min-h-12 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/[0.06] px-2 py-1.5 sm:grid-cols-[3rem_minmax(0,1fr)_7rem]">
          <SlotNumber position={position} />
          <div className="flex min-w-0 items-center gap-3">
            <PlanetImageSkeleton className="h-11 w-11 flex-shrink-0 rounded-md border border-cyan-300/25" />
            <div className="min-w-0">
              <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
              <div className="mt-2 h-3 w-44 max-w-full animate-pulse rounded bg-white/5" />
            </div>
          </div>
          <div className="hidden justify-self-end text-xs text-cyan-100/70 sm:block">Home loading</div>
        </div>
      );
    }

    return (
      <div className="grid min-h-11 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2 rounded-md border border-white/5 bg-black/15 px-2 py-1 sm:grid-cols-[3rem_minmax(0,1fr)_minmax(8rem,auto)]">
        <SlotNumber position={position} muted />
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-500">Empty space</div>
        </div>
      </div>
    );
  }

  const commanderLabel = formatGalaxyCommanderLabel(planet);
  const allianceLabel = formatGalaxyAllianceIdentityLabel(planet.alliance);
  const debrisLabel = planet.debrisField
    ? `${formatCompactResource(planet.debrisField.metal)} M / ${formatCompactResource(planet.debrisField.crystal)} C`
    : null;
  const moonChanceLabel = formatMoonChanceLabel(planet.moonChance);
  const planetOwner = planet.occupiedBy?.owner ?? planet.ownerId;
  const isOwnedByAccount = Boolean(account && planetOwner?.toLowerCase() === account.toLowerCase());
  const watched = Boolean(planet.occupiedBy?.planetId && watchedPlanetIds.includes(planet.occupiedBy.planetId));
  const moonActions = galaxyActionsForMoonSlot({
    account,
    attackProtection,
    defenseState,
    homePlanetId,
    planet,
    shipyardState,
  });
  const meta: PlanetMetaItem[] = [
    { label: formatGalaxyHeatLabel(planet.temperature) },
    { label: `${planet.fields} fields` },
    ...(planet.migrationReservation ? [{ label: "Reserved", tone: "info" as const }] : []),
    ...(attackProtection?.defenderInactive ? [{ label: "Inactive", tone: "warning" as const }] : []),
    ...(debrisLabel ? [{ label: debrisLabel, tone: "warning" as const }] : []),
    ...(moonChanceLabel ? [{ label: moonChanceLabel, tone: "info" as const }] : []),
  ];

  return (
    <WatchablePlanetRow
      actionSlot={(
        <GalaxyActionButtons
          actions={actions}
          busy={actionState.status === "pending" || Boolean(transactionUnavailableReason)}
          busyReason={transactionUnavailableReason}
          coords={coords}
          onAction={onAction}
          planet={planet}
        />
      )}
      allianceLabel={allianceLabel}
      commanderLabel={commanderLabel}
      compact
      coords={coords}
      isHome={isHome}
      leadingSlot={<SlotNumber position={position} />}
      meta={meta}
      mobileIdentityInMeta
      moonActionSlot={moonActions.length > 0 ? (
        <GalaxyMoonActionButtons
          actions={moonActions}
          busy={actionState.status === "pending" || Boolean(transactionUnavailableReason)}
          busyReason={transactionUnavailableReason}
          coords={coords}
          onAction={onAction}
          planet={planet}
        />
      ) : undefined}
      onInspect={onSelectPlanet}
      onInspectMoon={onSelectMoon}
      onSelectAlliance={onSelectAlliance}
      onSelectPlayer={onSelectPlayer}
      onToggleWatch={!isOwnedByAccount && planet.occupiedBy?.planetId
        ? () => onToggleWatchPlanet?.(planet.occupiedBy!.planetId, watched)
        : undefined}
      planet={planet}
      showMoonIndicator={false}
      watchBusy={watchBusyPlanetId === planet.occupiedBy?.planetId}
      watched={watched}
    />
  );
}

type MoonTargetActionKind = "attack" | "transport" | "deploy" | "defenseHold";

export function galaxyMoonActionsForSlot({
  account,
  actions,
  planet,
}: {
  account: string | undefined;
  actions: GalaxyAction[];
  planet: Planet;
}): GalaxyAction[] {
  if (!planet.hasMoon) return [];

  const actionsByKind = new Map(actions.map((action) => [action.kind, action]));
  const owner = planet.occupiedBy?.owner ?? planet.ownerId;
  const isOwnTarget = Boolean(account && owner?.toLowerCase() === account.toLowerCase());

  if (isOwnTarget) {
    return [
      moonTargetGalaxyAction(actionsByKind.get("transport"), "transport", "Transport"),
      moonTargetGalaxyAction(actionsByKind.get("deploy"), "deploy", "Deploy"),
      disabledMoonTargetGalaxyAction(
        "defenseHold",
        "Defend",
        "Stationed defense can only target planets in the current mission contract.",
      ),
    ];
  }

  const defendAction = actionsByKind.get("defenseHold");
  return defendAction
    ? [disabledMoonTargetGalaxyAction(
        "defenseHold",
        "Defend",
        "Stationed defense can only target planets in the current mission contract.",
      )]
    : [moonTargetGalaxyAction(actionsByKind.get("attack"), "attack", "Attack")];
}

export function galaxyActionsForMoonSlot({
  account,
  attackProtection,
  defenseState,
  homePlanetId,
  planet,
  shipyardState,
}: {
  account: string | undefined;
  attackProtection?: AttackProtectionStatus | undefined;
  defenseState: ChainDefenseState | null;
  homePlanetId: string | null | undefined;
  planet: Planet;
  shipyardState: ChainShipyardState | null;
}): GalaxyAction[] {
  const actions = galaxyActionsForSlot({
    account,
    attackProtection,
    defenseState,
    homePlanetId,
    // A parent planet may be the launch body while its moon is the target body.
    // They share a planet id but are not the same mission endpoint.
    isOrigin: false,
    planet,
    shipyardState,
  });
  return galaxyMoonActionsForSlot({ account, actions, planet });
}

function moonTargetGalaxyAction(
  action: GalaxyAction | undefined,
  kind: MoonTargetActionKind,
  label: string,
): GalaxyAction {
  if (!action) return disabledMoonTargetGalaxyAction(kind, label, `${label} is unavailable for this moon.`);
  if (!action.enabled) return { ...action, label };
  if (action.mode !== "mission" || action.kind !== kind) {
    return disabledMoonTargetGalaxyAction(kind, label, `${label} is unavailable for this moon.`);
  }

  return {
    ...action,
    label,
    defaultTargetIsMoon: true,
  };
}

function disabledMoonTargetGalaxyAction(
  kind: MoonTargetActionKind,
  label: string,
  reason: string,
): GalaxyAction {
  return {
    enabled: false,
    kind,
    label,
    mode: "mission",
    mission: kind,
    reason,
  };
}

function GalaxyMoonActionButtons({
  actions,
  busy,
  busyReason,
  coords,
  onAction,
  planet,
}: {
  actions: GalaxyAction[];
  busy: boolean;
  busyReason?: string | undefined;
  coords: Coordinates;
  onAction: ((action: GalaxyAction, target: Planet | undefined, coords: Coordinates) => void) | undefined;
  planet: Planet;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <GalaxyActionButtons
        actions={actions}
        busy={busy}
        busyReason={busyReason}
        coords={coords}
        onAction={onAction}
        planet={planet}
      />
    </div>
  );
}

export function GalaxyActionButtons({
  actions,
  busy,
  busyReason,
  coords,
  onAction,
  planet,
}: {
  actions: GalaxyAction[];
  busy: boolean;
  busyReason?: string | undefined;
  coords: Coordinates;
  onAction: ((action: GalaxyAction, target: Planet | undefined, coords: Coordinates) => void) | undefined;
  planet: Planet | undefined;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {actions.map((action) => {
        const Icon = galaxyActionIcon(action.kind);
        const disabled = !action.enabled || busy || !onAction;
        const hint = busyReason
          ?? (!onAction ? `${action.label} is unavailable.` : action.enabled ? action.label : `${action.label}: ${action.reason}`);
        return (
          <button
            aria-label={hint}
            className={`inline-flex h-11 w-11 items-center justify-center rounded border transition xl:h-8 xl:w-8 ${
              !disabled
                ? "border-signal/30 bg-signal/10 text-signal hover:bg-signal/20"
                : "cursor-not-allowed border-white/10 bg-white/[0.03] text-slate-500"
            }`}
            disabled={disabled}
            key={action.kind}
            onClick={() => {
              if (action.enabled) onAction?.(action, planet, coords);
            }}
            title={hint}
            type="button"
          >
            <Icon aria-hidden="true" size={15} strokeWidth={1.9} />
          </button>
        );
      })}
    </div>
  );
}

export function formatMissionPreview(preview: GalaxyMissionPreview): string {
  const slotLabel = `Fleet ${preview.fleetSlots.active}/${preview.fleetSlots.limit}`;
  if (preview.blockedReason) return `${slotLabel} / ${preview.blockedReason}`;

  return `${slotLabel} / Fuel ${preview.fuelCost.toLocaleString()} D / Cargo ${preview.cargoCapacity.toLocaleString()} / Arrives ${formatMissionClock(preview.arrivalAt)} / Returns ${formatMissionClock(preview.returnAt)}`;
}

export function formatAttackBlockReason(status: AttackProtectionStatus | undefined): string | undefined {
  if (!status || status.allowed || status.blockedReason === "none") return undefined;
  if (status.blockedReasonLabel) return status.blockedReasonLabel;
  if (status.blockedReason === "bashing_limit") return "Attack blocked by bashing limit";
  if (status.blockedReason === "score_protection") return "Attack blocked: score protection allows a 1.5× gap below 50,000 score and a 10× gap below 500,000.";
  if (status.blockedReason === "same_alliance") return "Attack blocked: target belongs to your alliance.";
  return "Attack blocked";
}

export function formatMoonChanceLabel(moonChance: Planet["moonChance"]): string | null {
  if (!moonChance) return null;
  const chance = typeof moonChance.chanceBps === "number"
    ? ` ${(moonChance.chanceBps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
    : "";
  const destructionChance = typeof moonChance.moonDestructionChanceBps === "number"
    ? ` ${(moonChance.moonDestructionChanceBps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
    : "";
  if (moonChance.status === "pending") return `Moon chance${chance} pending`;
  if (moonChance.status === "created") return `Moon created${moonChance.moonDiameterKm ? ` ${moonChance.moonDiameterKm.toLocaleString()} km` : ""}`;
  if (moonChance.status === "not_created") return `Moon chance${chance} missed`;
  if (moonChance.status === "moon_destruction_pending") return `Moon destruction${destructionChance} pending`;
  if (moonChance.status === "moon_destroyed") return "Moon destroyed";
  if (moonChance.status === "moon_survived") return "Moon survived";
  return "Existing moon skipped";
}

function formatMissionClock(timestamp: number): string {
  return formatUserTimestamp(timestamp);
}

export function formatCompactResource(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toString();
}

function SlotNumber({ position, muted = false }: { position: number; muted?: boolean }) {
  return (
    <div className={`flex h-8 w-8 items-center justify-center rounded border font-mono text-xs sm:h-9 sm:w-9 ${
      muted
        ? "border-white/5 bg-white/[0.02] text-slate-700"
        : "border-white/10 bg-black/20 text-slate-400"
    }`}>
      {position}
    </div>
  );
}

function sameCoordinates(homeCoords: Coordinates | undefined, planet: Planet): boolean {
  return Boolean(
    homeCoords
      && homeCoords.galaxy === planet.galaxy
      && homeCoords.system === planet.system
      && homeCoords.position === planet.position
  );
}

function sameCoordinateValues(left: Coordinates, right: Coordinates): boolean {
  return left.galaxy === right.galaxy
    && left.system === right.system
    && left.position === right.position;
}

function withHomePlanet(
  planets: Planet[],
  homePlanet: Planet | undefined
): Planet[] {
  if (homePlanet) {
    return mergePlanetAtCoordinates(planets, homePlanet);
  }

  return planets;
}

export function withOwnedPlanetNames(
  planets: Planet[],
  ownedPlanets: readonly Planet[]
): Planet[] {
  return ownedPlanets.reduce((current, ownedPlanet) => {
    const publicPlanet = current.find((planet) => sameCoordinateValues(planet, ownedPlanet));
    const namedPlanet = publicPlanet
      ? {
          ...publicPlanet,
          name: ownedPlanet.name,
          ...(ownedPlanet.moonName ? { moonName: ownedPlanet.moonName } : {}),
        }
      : ownedPlanet;
    return mergePlanetAtCoordinates(current, namedPlanet);
  }, planets);
}
