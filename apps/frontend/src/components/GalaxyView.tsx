import { useState, useEffect, useRef } from "preact/hooks";
import type { Planet, Coordinates } from "../types";
import {
  fleetMissionDistance,
  fleetMissionFuelCost,
  fleetMissionShipCount,
  fleetMissionTravelSeconds,
} from "../fleetMissionRules";
import type { MissionShips } from "../galaxyActions";
import {
  formatPlanetType,
  generateSystem,
  GALAXY_COUNT,
  SYSTEM_COUNT,
  POSITION_COUNT,
  mergePlanetAtCoordinates,
  planetsFromSystemResponse,
  planetTypeFromTemperature
} from "../data/mockUniverse";
import { playableApiUrl } from "../runtimeConfig";
import { shortAddress } from "../walletFlow";
import type { ChainDefenseState, ChainShipyardState } from "../walletFlow";
import {
  galaxyActionsForSlot,
  type GalaxyAction,
} from "../galaxyActions";
import { isImageReady } from "../imageLoadState";
import { OptimizedImage } from "./OptimizedImage";
import { PlanetImageSkeleton } from "./PlanetImageSkeleton";

const SMALL_CARGO_CAPACITY = 5_000;
const SMALL_CARGO_SHIP_ID = 0;

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
  defenseState?: ChainDefenseState | null | undefined;
  shipyardState?: ChainShipyardState | null | undefined;
  onAction?: ((action: GalaxyAction, target: Planet | undefined, coords: Coordinates) => void) | undefined;
  onSelectPlanet: (coords: Coordinates) => void;
  onNavigate: (galaxy: number, system: number) => void;
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
  defenseState = null,
  shipyardState = null,
  onAction,
  onSelectPlanet,
  onNavigate,
}: Props) {
  const [planets, setPlanets] = useState<Planet[]>([]);
  const [attackProtection, setAttackProtection] = useState<Record<string, AttackProtectionStatus>>({});
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"api" | "fallback" | "loading">("loading");
  const homeCoordsInSystem = homeCoords?.galaxy === galaxy && homeCoords.system === system
    ? homeCoords
    : undefined;
  const homePlanetOverride = homePlanet?.galaxy === galaxy && homePlanet.system === system
    ? homePlanet
    : undefined;

  useEffect(() => {
    const abortController = new AbortController();
    setLoading(true);
    setSource("loading");

    fetch(`${apiBaseUrl.replace(/\/+$/, "")}/universe/galaxies/${galaxy}/systems/${system}`, {
      headers: { accept: "application/json" },
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Universe request failed with ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        setPlanets(withHomePlanet(planetsFromSystemResponse(payload), homePlanetOverride));
        setSource("api");
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.error(error);
          setPlanets(withHomePlanet(generateSystem(galaxy, system), homePlanetOverride));
          setSource("fallback");
        }
      })
      .finally(() => {
        if (!abortController.signal.aborted) setLoading(false);
      });

    return () => abortController.abort();
  }, [apiBaseUrl, galaxy, homeCoordsInSystem?.position, homePlanetOverride?.fields, homePlanetOverride?.image, system]);

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
  const homePlanetInSystem = planets.find((planet) => sameCoordinates(homeCoords, planet));
  const occupiedCount = planets.filter((planet) => planet.occupiedBy || sameCoordinates(homeCoords, planet)).length;
  const debrisCount = planets.filter((planet) => planet.debrisField).length;
  const moonChanceCount = planets.filter((planet) => planet.moonChance).length;
  const emptyCount = POSITION_COUNT - planets.length;
  const occupiedSummary = formatGalaxyOccupancySummary(occupiedCount);
  const occupancySource = formatGalaxyOccupancySource(source, Boolean(homePlanetInSystem));

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white">Galaxy</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            System [{galaxy}:{system}:1-{POSITION_COUNT}]
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-[#101624] p-2 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset]">
          <button
            onClick={handlePrevSystem}
            className="h-9 rounded border border-white/15 bg-white/8 px-3 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
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
            className="h-9 rounded border border-white/15 bg-white/8 px-3 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
          >
            Next →
          </button>
        </div>
      </div>

      <div className="grid gap-2 rounded-lg border border-white/10 bg-[#101624] p-2 sm:p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-1 pb-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{planets.length} planet slots</span>
            <span className="text-slate-700">/</span>
            <span>{emptyCount} empty</span>
            <span className="text-slate-700">/</span>
            <span>{occupiedSummary}</span>
            {debrisCount > 0 ? (
              <>
                <span className="text-slate-700">/</span>
                <span>{debrisCount} debris</span>
              </>
            ) : null}
            {moonChanceCount > 0 ? (
              <>
                <span className="text-slate-700">/</span>
                <span>{moonChanceCount} moon chance</span>
              </>
            ) : null}
          </div>
          {occupancySource ? (
            <span className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-500">
              {occupancySource}
            </span>
          ) : null}
        </div>
        {actionState.status !== "idle" ? (
          <div className={`rounded border px-3 py-2 text-xs ${
            actionState.status === "error"
              ? "border-red-300/30 bg-red-500/10 text-red-100"
              : actionState.status === "success"
                ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
                : "border-signal/25 bg-signal/10 text-signal"
          }`}>
            {actionState.label}
          </div>
        ) : null}

        <div className="grid gap-1.5">
          {loading && (
            <div className="py-12 text-center text-sm text-slate-400">
              Loading system data...
            </div>
          )}

          {!loading &&
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
                  onAction={onAction}
                  attackProtection={planet?.occupiedBy ? attackProtection[planet.occupiedBy.planetId] : undefined}
                  homeCoords={homeCoordsInSystem}
                  homePlanetId={homePlanetId}
                  planet={planet}
                  position={pos}
                  defenseState={defenseState}
                  shipyardState={shipyardState}
                  system={system}
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

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commitDraft = () => {
    const parsed = Number.parseInt(draft, 10);

    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }

    const nextValue = clampInteger(parsed, 1, max);
    setDraft(String(nextValue));
    if (nextValue !== value) onCommit(nextValue);
  };

  return (
    <label className="flex h-9 items-center gap-2 rounded border border-white/15 bg-[#070913] px-2">
      <span className="text-[11px] font-medium uppercase text-slate-500">{label}</span>
      <input
        aria-label={label}
        inputMode="numeric"
        maxLength={String(max).length}
        onBlur={commitDraft}
        onChange={(event) => setDraft((event.currentTarget as HTMLInputElement).value.replace(/\D/g, ""))}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            (event.currentTarget as HTMLInputElement).blur();
          }
          if (event.key === "Escape") {
            setDraft(String(value));
            (event.currentTarget as HTMLInputElement).blur();
          }
        }}
        pattern="[0-9]*"
        value={draft}
        className="h-7 w-12 rounded border border-white/10 bg-[#101624] px-2 text-center font-mono text-sm font-semibold text-white outline-none [color-scheme:dark] focus:border-signal/50"
      />
    </label>
  );
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function formatGalaxyOccupancySummary(occupiedCount: number): string {
  return occupiedCount > 0 ? `${occupiedCount} occupied` : "No occupants";
}

export function formatGalaxyOccupancySource(
  source: "api" | "fallback" | "loading",
  hasHomePlanet: boolean
): string | undefined {
  if (source === "loading") return "Loading";
  if (hasHomePlanet || source === "api") return undefined;
  return "Preview system";
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
  const missionShipCount = planner.missionShips ? fleetMissionShipCount(planner.missionShips) : 1;
  const travelSeconds = galaxyMissionTravelSeconds(homeCoords, target);
  const fuelCost = galaxyMissionFuelCost(homeCoords, target, missionShipCount);
  const arrivalAt = now + travelSeconds * 1_000;
  const returnAt = arrivalAt + travelSeconds * 1_000;
  let blockedReason: string | undefined;

  if (sameCoordinateValues(homeCoords, target)) {
    blockedReason = "Origin planet";
  } else if (fleetSlots.active >= fleetSlots.limit) {
    blockedReason = "No fleet slots open";
  } else if (smallCargoCount < 1) {
    blockedReason = "No Small Cargo available";
  } else if ((planner.resources?.deuterium ?? 0) < fuelCost) {
    blockedReason = `Need ${fuelCost.toLocaleString()} deuterium`;
  }

  return {
    blockedReason,
    cargoCapacity: SMALL_CARGO_CAPACITY,
    fleetSlots,
    fuelCost,
    arrivalAt,
    returnAt,
  };
}

export function galaxyMissionTravelSeconds(origin: Coordinates, target: Coordinates): number {
  return fleetMissionTravelSeconds(fleetMissionDistance(origin, target));
}

export function galaxyMissionFuelCost(origin: Coordinates, target: Coordinates, shipCount: number): number {
  return fleetMissionFuelCost(shipCount, fleetMissionDistance(origin, target));
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
}) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const isPendingHomePlanet = !planet && homeCoords?.position === position;
  const coords = { galaxy, system, position };
  const actions = galaxyActionsForSlot({
    account,
    homePlanetId,
    isOrigin: isHome,
    planet,
    defenseState,
    shipyardState,
  });

  useEffect(() => {
    setImageLoaded(isImageReady(imageRef.current));
  }, [planet?.image]);

  if (!planet) {
    if (isPendingHomePlanet) {
      return (
        <div className="grid min-h-16 grid-cols-[3rem_minmax(0,1fr)] items-center gap-3 rounded-md border border-cyan-300/25 bg-cyan-300/[0.06] px-3 py-2 sm:grid-cols-[4rem_minmax(0,1fr)_7rem]">
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
      <div className="grid min-h-16 grid-cols-[3rem_minmax(0,1fr)] items-center gap-3 rounded-md border border-white/5 bg-black/15 px-3 py-2 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(8rem,auto)]">
        <SlotNumber position={position} muted />
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-500">Empty space</div>
          <div className="text-xs text-slate-700">No generated or indexed planet at this position.</div>
        </div>
        <ActionButtons
          actions={actions}
          busy={actionState.status === "pending"}
          coords={coords}
          onAction={onAction}
          planet={undefined}
        />
      </div>
    );
  }

  const ownerLabel = isHome
    ? "Settled home"
    : planet.ownerId
      ? shortAddress(planet.ownerId)
      : "Unclaimed";
  const debrisLabel = planet.debrisField
    ? `${formatCompactResource(planet.debrisField.metal)} M / ${formatCompactResource(planet.debrisField.crystal)} C`
    : null;
  const moonChanceLabel = formatMoonChanceLabel(planet.moonChance);
  const attackBlockLabel = formatAttackBlockReason(attackProtection);

  return (
    <div
      className={`group grid min-h-16 w-full grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md border px-3 py-2 text-left transition sm:grid-cols-[4rem_minmax(0,1fr)_7rem_auto] ${
        isHome
          ? "border-cyan-300/40 bg-cyan-300/10 shadow-[0_0_18px_rgba(103,232,249,0.10)]"
          : "border-white/10 bg-white/[0.035] hover:border-signal/35 hover:bg-white/[0.06]"
      }`}
    >
      <SlotNumber position={position} />

      <button
        className="flex min-w-0 items-center gap-3 text-left"
        onClick={() => onSelectPlanet(coords)}
        type="button"
      >
        <div className={`relative h-11 w-11 flex-shrink-0 overflow-hidden rounded-md border bg-black/30 ${
          isHome ? "border-cyan-300/35" : "border-white/15"
        }`}>
          {!imageLoaded && <PlanetImageSkeleton className="absolute inset-0" />}
          <OptimizedImage
            key={planet.image}
            alt={planet.name}
            className={`h-full w-full object-cover transition-opacity duration-200 ${imageLoaded ? "opacity-100" : "opacity-0"}`}
            imageRef={imageRef}
            loading="eager"
            onLoad={(event) => {
              if (isImageReady(event.currentTarget)) setImageLoaded(true);
            }}
            sizes="icon"
            src={planet.image}
          />
        </div>

        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-white group-hover:text-signal">
              {planet.name}
            </span>
            {isHome ? (
              <span className="rounded border border-cyan-300/35 bg-cyan-300/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-cyan-100">
                Home
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{formatGalaxyHeatLabel(planet.temperature)}</span>
            <span className="text-slate-700">/</span>
            <span>{planet.fields} fields</span>
            {planet.hasMoon ? (
              <>
                <span className="text-slate-700">/</span>
                <span>Moon</span>
              </>
            ) : null}
            {attackBlockLabel ? (
              <>
                <span className="text-slate-700">/</span>
                <span className="text-amber-200">{attackBlockLabel}</span>
              </>
            ) : null}
            {debrisLabel ? (
              <>
                <span className="text-slate-700">/</span>
                <span className="text-amber-200">{debrisLabel}</span>
              </>
            ) : null}
            {moonChanceLabel ? (
              <>
                <span className="text-slate-700">/</span>
                <span className="text-cyan-200">{moonChanceLabel}</span>
              </>
            ) : null}
          </div>
        </div>
      </button>

      <div className={`hidden justify-self-end text-xs font-medium sm:block ${isHome ? "text-cyan-100" : "text-slate-500"}`}>
        {ownerLabel}
      </div>

      <div className="flex flex-wrap justify-end gap-1.5">
        <button
          className="rounded border border-signal/25 px-2 py-1 text-xs font-medium text-signal hover:bg-signal/10"
          onClick={() => onSelectPlanet(coords)}
          type="button"
        >
          Inspect
        </button>
        <ActionButtons
          actions={actions}
          busy={actionState.status === "pending"}
          coords={coords}
          onAction={onAction}
          planet={planet}
        />
      </div>
    </div>
  );
}

function ActionButtons({
  actions,
  busy,
  coords,
  onAction,
  planet,
}: {
  actions: GalaxyAction[];
  busy: boolean;
  coords: Coordinates;
  onAction: ((action: GalaxyAction, target: Planet | undefined, coords: Coordinates) => void) | undefined;
  planet: Planet | undefined;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {actions.map((action) => (
        <button
          className={`rounded border px-2 py-1 text-xs font-medium transition ${
            action.enabled
              ? "border-signal/30 bg-signal/10 text-signal hover:bg-signal/20"
              : "cursor-not-allowed border-white/10 bg-white/[0.03] text-slate-500"
          }`}
          disabled={!action.enabled || busy || !onAction}
          key={action.kind}
          onClick={() => {
            if (action.enabled) onAction?.(action, planet, coords);
          }}
          title={action.enabled ? action.label : action.reason}
          type="button"
        >
          {action.label}
        </button>
      ))}
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
  if (status.blockedReason === "score_protection") return "Attack blocked by score protection";
  if (status.blockedReason === "same_alliance") return "Attack blocked by alliance membership";
  return "Attack blocked";
}

export function formatMoonChanceLabel(moonChance: Planet["moonChance"]): string | null {
  if (!moonChance) return null;
  const chance = typeof moonChance.chanceBps === "number"
    ? ` ${(moonChance.chanceBps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
    : "";
  if (moonChance.status === "pending") return `Moon chance${chance} pending`;
  if (moonChance.status === "created") return `Moon created${moonChance.moonDiameterKm ? ` ${moonChance.moonDiameterKm.toLocaleString()} km` : ""}`;
  if (moonChance.status === "not_created") return `Moon chance${chance} missed`;
  return "Existing moon skipped";
}

function formatMissionClock(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatCompactResource(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toString();
}

function SlotNumber({ position, muted = false }: { position: number; muted?: boolean }) {
  return (
    <div className={`flex h-9 w-9 items-center justify-center rounded border font-mono text-sm sm:h-10 sm:w-10 ${
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
