import { ChevronLeft, ChevronRight } from "lucide-preact";

import { planetArtTypeFromArchetypeOrCoords, planetImageForType } from "../data/mockUniverse";
import { buildInspectHash } from "../inspectRoutes";
import { timestampToMs } from "../timestampFormat";
import type { Coordinates, PlanetType } from "../types";
import { type FleetMissionSummary, decodeColonizationTargetId } from "../walletFlow";

// Shared route element used by both Mission Control and the Mission Detail page (VEY-KANEO-426). It
// renders a single origin -> target row: real planet art and a clickable name + commander on each
// outer edge, with a directional, progress-filled arrow spanning the gap. Both screens drive it from
// the same `MissionEndpoint` model so they always look the same and stay in sync.
//
// Navigation is pluggable so each screen keeps its existing behaviour: Mission Control passes no
// handlers and the endpoints render as hash links (`buildInspectHash`); Mission Detail passes
// `onSelectCoordinates`/`onSelectPlayer` and the endpoints render as buttons that call back into the
// page's existing in-app navigation.

export type MissionEndpoint = {
  // Real planet archetype used to pick the planet art asset (VEY-403 / VEY-67); null only when the
  // endpoint has no resolvable planet (e.g. a battle-report attacker with no coordinates).
  archetype: PlanetType | null;
  commanderName: string | null;
  commanderWallet: string | null;
  coordinates: string | null;
  coords: Coordinates | null;
  name: string;
};

export type MissionPlanetIdentity = {
  archetype: PlanetType | null;
  coordinates: string;
  displayName: string;
  owner: string;
  ownerDisplayName: string | null;
};

// The leg of the journey a card's route arrow represents: an outbound fleet flies origin -> target,
// a returning/recalled/returned fleet flies back target -> origin (home). The arrow points along
// this leg and fills with mission progress (VEY-403).
export type RouteLeg = "outbound" | "returning";

export function missionRouteLeg(status: string): RouteLeg {
  return status === "Returning" || status === "Recalled" || status === "Returned" ? "returning" : "outbound";
}

// Fraction of the active leg already flown, used to fill the route arrow. Outbound legs measure from
// (arrival - duration) to arrival; returning legs measure from arrival to return.
export function missionProgressPercent(mission: FleetMissionSummary, now: number): number {
  const arrivalAt = timestampToMs(mission.arrivalAt);
  const returnAt = timestampToMs(mission.returnAt);
  if (arrivalAt === undefined || returnAt === undefined) return 0;

  const returning = mission.status === "Returning" || mission.status === "Recalled" || mission.status === "Returned";
  const duration = Math.abs(returnAt - arrivalAt);
  const start = returning ? arrivalAt : arrivalAt - duration;
  const end = returning ? returnAt : arrivalAt;
  if (end <= start) return 100;

  return clamp(((now - start) / (end - start)) * 100, 0, 100);
}

// Optional in-app navigation handlers. When provided, the endpoints render as buttons that call
// these (Mission Detail); when omitted, they render as hash links (Mission Control).
type RouteNavigation = {
  onSelectCoordinates?: ((coords: Coordinates) => void) | undefined;
  onSelectPlayer?: ((wallet: string) => void) | undefined;
};

// The single shared, alignment-clean route cell used by every mission table — active My missions /
// Alliance and Past missions (VEY-399#5, VEY-403) and the Mission Detail Route hero (VEY-KANEO-426).
// Each endpoint renders its real planet art plus a clickable name + commander; between them a
// directional arrow points along the active leg (outbound -> target, returning -> home) and fills
// with mission progress. An optional whole-route subtext (e.g. "Returned · <time>") sits below.
export function MissionRouteCell({
  direction,
  onSelectCoordinates,
  onSelectPlayer,
  origin,
  progressPercent,
  subtext,
  target,
}: {
  direction: RouteLeg;
  origin: MissionEndpoint;
  progressPercent?: number | undefined;
  subtext?: string | undefined;
  target: MissionEndpoint;
} & RouteNavigation) {
  const nav: RouteNavigation = { onSelectCoordinates, onSelectPlayer };
  return (
    <div className="min-w-0">
      {/* Origin hugs the left edge, target hugs the right edge, and the directional arrow spans the
          full gap between them (VEY-403 rework). The endpoint columns size to their content but are
          capped (via the RouteEndpoint max-width) so the arrow always owns the central span. */}
      <div className="grid grid-cols-[minmax(0,auto)_minmax(2.5rem,1fr)_minmax(0,auto)] items-center gap-x-2 sm:gap-x-3">
        <RouteEndpoint align="left" endpoint={origin} nav={nav} />
        <RouteArrow direction={direction} progressPercent={progressPercent ?? 100} />
        <RouteEndpoint align="right" endpoint={target} nav={nav} />
      </div>
      {subtext ? <p className="mt-1.5 text-[11px] text-slate-500">{subtext}</p> : null}
    </div>
  );
}

// One side of the route: the planet art asset pinned to the outer edge (origin on the left, target
// on the right via the mirrored layout) with the clickable planet name + commander stacked
// alongside it. Width is capped so long planet names truncate instead of squeezing the arrow.
function RouteEndpoint({ align, endpoint, nav }: { align: "left" | "right"; endpoint: MissionEndpoint; nav: RouteNavigation }) {
  return (
    <div className={`flex min-w-0 max-w-[7rem] items-center gap-2 sm:max-w-[11rem] ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      <EndpointPlanetImage endpoint={endpoint} />
      <div className="min-w-0">
        <EndpointName endpoint={endpoint} nav={nav} />
        <EndpointCommander endpoint={endpoint} nav={nav} />
      </div>
    </div>
  );
}

// Real planet art for an endpoint (the same asset set the Galaxy view uses for thumbnails — VEY-67).
// Falls back to a subtle ringed placeholder only when no planet can be resolved (e.g. a
// battle-report attacker without coordinates).
function EndpointPlanetImage({ endpoint }: { endpoint: MissionEndpoint }) {
  const frameClass = "relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-white/15 bg-black/30 sm:h-9 sm:w-9";
  if (!endpoint.archetype) {
    return <span aria-hidden="true" className={`${frameClass} flex items-center justify-center`}><span className="h-3 w-3 rounded-full border border-white/25" /></span>;
  }
  return (
    <span className={frameClass}>
      <img
        alt={`${endpoint.name} planet`}
        className="h-full w-full object-cover"
        data-planet-art={endpoint.archetype}
        loading="lazy"
        src={planetImageForType(endpoint.archetype)}
      />
    </span>
  );
}

function EndpointName({ endpoint, nav }: { endpoint: MissionEndpoint; nav: RouteNavigation }) {
  const linkClass = "block min-w-0 truncate rounded font-medium text-cyan-100 underline-offset-2 transition hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/50";
  const title = endpoint.coordinates ? `Open ${endpoint.coordinates} in Galaxy` : undefined;
  if (endpoint.coords) {
    const coords = endpoint.coords;
    // Mission Detail wires in-app navigation through a callback; Mission Control links via the hash.
    if (nav.onSelectCoordinates) {
      return (
        <button className={`${linkClass} text-left`} onClick={() => nav.onSelectCoordinates?.(coords)} title={title} type="button">
          {endpoint.name}
        </button>
      );
    }
    return (
      <a className={linkClass} href={buildInspectHash({ coords, kind: "planet" })} title={title}>
        {endpoint.name}
      </a>
    );
  }
  return (
    <span className="block min-w-0 truncate font-medium text-slate-100" title={endpoint.coordinates ?? undefined}>
      {endpoint.name}
    </span>
  );
}

function EndpointCommander({ endpoint, nav }: { endpoint: MissionEndpoint; nav: RouteNavigation }) {
  if (!endpoint.commanderName) return null;
  const commanderName = endpoint.commanderName;
  const wallet = endpoint.commanderWallet;
  const linkClass = "rounded text-slate-300 underline-offset-2 transition hover:text-cyan-100 hover:underline focus-visible:underline focus-visible:outline-none";
  return (
    <p className="truncate text-slate-400">
      {wallet ? (
        nav.onSelectPlayer ? (
          <button className={`${linkClass} text-left`} onClick={() => nav.onSelectPlayer?.(wallet)} title={`Inspect ${commanderName}`} type="button">
            {commanderName}
          </button>
        ) : (
          <a className={linkClass} href={buildInspectHash({ kind: "player", wallet })} title={`Open ${commanderName}'s profile`}>
            {commanderName}
          </a>
        )
      ) : (
        commanderName
      )}
    </p>
  );
}

// Directional, progress-filled route arrow (VEY-403). The arrowhead always points along the active
// leg — right toward the target for outbound fleets, left toward home for returning fleets — and a
// cyan fill grows from the trailing end to the current position, ending in a matching arrowhead, so
// the head sits at 100% on arrival/return. A muted destination chevron marks the leading end even at
// 0% progress.
function RouteArrow({ direction, progressPercent }: { direction: RouteLeg; progressPercent: number }) {
  const progress = clamp(progressPercent, 0, 100);
  const returning = direction === "returning";
  const rounded = Math.round(progress);
  const label = returning
    ? `Returning home, ${rounded}% of the way back`
    : `Outbound to target, ${rounded}% of the way there`;
  const Chevron = returning ? ChevronLeft : ChevronRight;
  // The track is inset by 0.5rem on each side to leave room for the destination chevron; the fill
  // and its leading chevron are positioned within that same inset span so the head reaches the tip
  // exactly at 100%. All transforms are inline to avoid clashing with Tailwind transform utilities.
  const fillStyle: Record<string, string> = returning
    ? { right: "0.5rem", width: `calc((100% - 1rem) * ${progress / 100})` }
    : { left: "0.5rem", width: `calc((100% - 1rem) * ${progress / 100})` };
  const headStyle: Record<string, string> = returning
    ? { right: `calc(0.5rem + (100% - 1rem) * ${progress / 100})`, transform: "translate(50%, -50%)" }
    : { left: `calc(0.5rem + (100% - 1rem) * ${progress / 100})`, transform: "translate(-50%, -50%)" };
  return (
    <div
      aria-label={label}
      className="relative h-5 w-full"
      data-route-arrow
      data-route-direction={direction}
      data-route-progress={String(rounded)}
      role="img"
    >
      {/* Muted full-length track. */}
      <span className="absolute inset-x-2 top-1/2 h-[3px] rounded-full bg-white/12" style={{ transform: "translateY(-50%)" }} />
      {/* Muted destination chevron pinned at the leading end (visible even at 0% progress). */}
      <span
        className={`absolute top-1/2 text-white/25 ${returning ? "left-0" : "right-0"}`}
        style={{ transform: "translateY(-50%)" }}
      >
        <Chevron aria-hidden="true" size={13} />
      </span>
      {/* Cyan progress fill growing from the trailing end toward the destination tip. */}
      <span
        className="absolute top-1/2 h-[3px] rounded-full bg-cyan-300"
        data-route-fill
        data-route-progress={String(rounded)}
        style={{ ...fillStyle, transform: "translateY(-50%)" }}
      />
      {/* Cyan arrowhead riding the leading edge of the fill, marking the current position. */}
      <span className="absolute top-1/2 text-cyan-200" data-route-head style={headStyle}>
        <Chevron aria-hidden="true" size={13} />
      </span>
    </div>
  );
}

// Resolves the planet archetype (art type) for an endpoint, preferring the mission feed's real
// archetype, then a shared-lookup archetype, then a deterministic coordinate-derived fallback so
// uncharted colonization targets still render planet art rather than a generic icon.
function endpointArchetype(
  refArchetype: PlanetType | null | undefined,
  identityArchetype: PlanetType | null | undefined,
  coords: Coordinates | null,
): PlanetType | null {
  return planetArtTypeFromArchetypeOrCoords(refArchetype ?? identityArchetype, coords);
}

// Resolves a mission endpoint to a clickable planet (name with coords fallback, coords on
// hover) and its commander, preferring the mission's own planet reference and falling back
// to the shared planet lookup or a colonization-target decode.
export function missionEndpoint(
  mission: FleetMissionSummary,
  side: "origin" | "target",
  planetLookup: ReadonlyMap<string, MissionPlanetIdentity>,
): MissionEndpoint {
  const ref = side === "origin" ? mission.originPlanet : mission.targetPlanet;
  const planetId = side === "origin" ? mission.originPlanetId : mission.targetPlanetId;
  const identity = planetLookup.get(planetId);
  const colony = ref ? null : decodeColonizationTargetId(planetId);
  const coordinates = ref?.coordinates ?? identity?.coordinates ?? colony?.coordinates ?? null;
  const coords = ref
    ? { galaxy: ref.galaxy, position: ref.position, system: ref.system }
    : colony
      ? { galaxy: colony.galaxy, position: colony.position, system: colony.system }
      : parseCoordinateString(coordinates);
  const rawName = ref?.name?.trim() || identityName(identity);
  const commanderWallet = ref?.owner ?? identity?.owner ?? (side === "origin" ? mission.owner : null);
  const commanderDisplay = ref?.ownerDisplayName?.trim() || identity?.ownerDisplayName?.trim() || null;
  return {
    archetype: endpointArchetype(ref?.archetype, identity?.archetype, coords),
    commanderName: commanderDisplay || (commanderWallet ? shortAddress(commanderWallet) : null),
    commanderWallet,
    coordinates,
    coords,
    name: rawName || (coordinates ? coordinates : colony ? "Uncharted" : `Planet #${planetId}`),
  };
}

// Builds a clickable route endpoint from a planet id alone (used by battle-report-only past rows,
// which carry no full mission planet reference) — VEY-399 shared route reuse.
export function endpointFromPlanetId(planetId: string, lookup: ReadonlyMap<string, MissionPlanetIdentity>): MissionEndpoint {
  const identity = lookup.get(planetId);
  const colony = decodeColonizationTargetId(planetId);
  const coordinates = identity?.coordinates ?? colony?.coordinates ?? null;
  const coords = colony
    ? { galaxy: colony.galaxy, position: colony.position, system: colony.system }
    : parseCoordinateString(coordinates);
  const commanderWallet = identity?.owner ?? null;
  const commanderDisplay = identity?.ownerDisplayName?.trim() || null;
  return {
    archetype: endpointArchetype(undefined, identity?.archetype, coords),
    commanderName: commanderDisplay || (commanderWallet ? shortAddress(commanderWallet) : null),
    commanderWallet,
    coordinates,
    coords,
    name: identityName(identity) || coordinates || `Planet #${planetId}`,
  };
}

// The shared planet identity stores "Planet [coords]" as its display fallback; strip that so
// the endpoint can show the coordinates themselves when there is no real planet name.
function identityName(identity: MissionPlanetIdentity | undefined): string | null {
  if (!identity) return null;
  return /^Planet \[/.test(identity.displayName) ? null : identity.displayName;
}

function parseCoordinateString(value: string | null): Coordinates | null {
  if (!value) return null;
  const parts = value.split(":").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part <= 0)) return null;
  return { galaxy: parts[0]!, position: parts[2]!, system: parts[1]! };
}

export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
