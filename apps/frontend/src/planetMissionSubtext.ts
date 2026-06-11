// Per-planet mission subtext (VEY-KANEO-445 / VEY-KANEO-446 / VEY-KANEO-448).
//
// Shared, DOM-free logic that turns the universe-wide active fleet-mission feed into compact subtext
// lines for a single planet. Both the Rankings page (VEY-445) and the Raid Target Finder (VEY-446)
// render these lines, so the classification lives here to keep the two surfaces consistent.
//
// VEY-KANEO-448 enriches each line so it states (1) the mission TYPE and (2) WHO originated it relative
// to the planet's owner: the owner's own fleet (outbound / returning home / own fleet arriving) versus
// an incoming THIRD PARTY (someone else's fleet heading to the planet), with hostile (Attack/AcsAttack)
// vs friendly emphasis. Full transparency (decision #9978, VEY-KANEO-445): the source feed is the
// unfiltered universe-wide active feed, so missions are never filtered by the viewing wallet.

import { formatDurationUntil } from "./durationFormat";
import { timestampToMs } from "./timestampFormat";
import { decodeColonizationTargetId, shortAddress, type FleetMissionSummary } from "./walletFlow";
import { missionTypeLabel } from "./components/MissionControlPage";

// Mission types that read as an attack on the planet; everything else (Transport, Deploy, AcsDefend,
// Colonize, …) is treated as friendly/neutral for styling.
const HOSTILE_MISSION_TYPES = new Set(["Attack", "AcsAttack"]);

export type PlanetMissionLine = {
  key: string;
  // Pre-rendered line copy: type + endpoint/originator + a live ETA.
  label: string;
  // Longer description for the row's title/tooltip (spells out owner vs third-party).
  title: string;
  // Relative direction for this planet: a fleet heading toward it ("incoming") or away from it
  // ("outgoing"). Drives the subtext icon.
  direction: "incoming" | "outgoing";
  // Whether the fleet belongs to the planet's own owner or to a third party heading to/from it.
  origin: "owner" | "third-party";
  // Whether the mission reads as hostile (attack). Only meaningful for third-party fleets; drives the
  // danger styling and the ⚔ marker.
  hostile: boolean;
};

export type PlanetMissionSubtext = {
  lines: PlanetMissionLine[];
  overflow: number;
};

// Max mission subtext lines rendered per planet before collapsing the rest into a "+N more" tail, so a
// busy planet stays compact in the rankings/raid lists.
export const maxPlanetMissionLines = 3;

// Active fleet missions touching each planet, indexed by planet id. A mission is filed under both its
// origin and its target planet so a planet row can surface every fleet currently flying to or from it.
export function activeMissionsByPlanetId(
  missions: readonly FleetMissionSummary[],
): Map<string, FleetMissionSummary[]> {
  const byPlanet = new Map<string, FleetMissionSummary[]>();
  const file = (planetId: string, mission: FleetMissionSummary) => {
    const list = byPlanet.get(planetId);
    if (list) list.push(mission);
    else byPlanet.set(planetId, [mission]);
  };
  for (const mission of missions) {
    file(mission.originPlanetId, mission);
    if (mission.targetPlanetId !== mission.originPlanetId) file(mission.targetPlanetId, mission);
  }
  return byPlanet;
}

// Compact mission subtext for a single planet: one live line per active mission touching it, sorted by
// the soonest upcoming event (arrival for outbound legs, landing for return legs), capped at
// `maxPlanetMissionLines` with the remainder surfaced as an overflow count. `planetOwner` is the wallet
// that owns the planet; it is compared against each mission's owner to tell owner-originated fleets
// apart from incoming third-party fleets.
export function planetMissionSubtext(
  planetId: string,
  planetOwner: string | null | undefined,
  missions: readonly FleetMissionSummary[],
  now: number,
): PlanetMissionSubtext {
  const resolved = missions
    .map((mission) => planetMissionLine(planetId, planetOwner, mission, now))
    .filter((line): line is PlanetMissionLine & { eta: number } => line !== null)
    .sort((left, right) => left.eta - right.eta);
  const lines = resolved.slice(0, maxPlanetMissionLines).map(({ eta: _eta, ...line }) => line);
  return { lines, overflow: Math.max(0, resolved.length - lines.length) };
}

function planetMissionLine(
  planetId: string,
  planetOwner: string | null | undefined,
  mission: FleetMissionSummary,
  now: number,
): (PlanetMissionLine & { eta: number }) | null {
  const returning = mission.status === "Returning" || mission.status === "Recalled";
  // The in-flight fleet is heading to its target on the outbound leg and back to its origin on the
  // return leg; the matching event time is the arrival (outbound) or the landing-at-home (return).
  const destinationId = returning ? mission.originPlanetId : mission.targetPlanetId;
  const sourceId = returning ? mission.targetPlanetId : mission.originPlanetId;
  const eventAt = returning ? mission.returnAt : mission.arrivalAt;
  const eta = timestampToMs(eventAt);
  if (eta === undefined) return null;

  const etaLabel = formatDurationUntil(eta, now);
  const typeLabel = missionTypeLabel(mission.missionType);
  const isOwner = !isThirdPartyMission(planetOwner, mission.owner);
  const hostile = HOSTILE_MISSION_TYPES.has(mission.missionType);

  if (destinationId === planetId) {
    // A fleet inbound to this planet — arriving (outbound leg) or landing back home (return leg).
    if (returning) {
      // A returning fleet lands at its own origin, which it owns: always the planet owner's own fleet.
      return {
        key: `${mission.missionId}-in`,
        label: `Returning (${typeLabel}) · ${etaLabel}`,
        title: `Owner's own ${typeLabel.toLowerCase()} fleet returning home · ${etaLabel}`,
        direction: "incoming",
        origin: "owner",
        hostile: false,
        eta,
      };
    }
    if (isOwner) {
      // The owner moving their own fleet to one of their planets (e.g. an internal transport).
      return {
        key: `${mission.missionId}-in`,
        label: `Own ${typeLabel.toLowerCase()} arriving · ${etaLabel}`,
        title: `Owner's own ${typeLabel.toLowerCase()} arriving · ${etaLabel}`,
        direction: "incoming",
        origin: "owner",
        hostile: false,
        eta,
      };
    }
    // A third party's fleet inbound to this planet — the key signal for raiders and defenders alike.
    const attacker = missionOwnerName(mission);
    return {
      key: `${mission.missionId}-in`,
      label: `Incoming ${typeLabel} from ${attacker} · ${etaLabel}`,
      title: `${hostile ? "Hostile" : "Friendly"} incoming ${typeLabel.toLowerCase()} from ${attacker} · ${etaLabel}`,
      direction: "incoming",
      origin: "third-party",
      hostile,
      eta,
    };
  }

  if (sourceId === planetId) {
    // A fleet outbound from this planet toward its current destination.
    const destination = missionEndpointCoordinatesLabel(mission, returning ? "origin" : "target");
    if (returning && !isOwner) {
      // A third party that struck this planet and is now heading home.
      const attacker = missionOwnerName(mission);
      return {
        key: `${mission.missionId}-out`,
        label: `${typeLabel} returning → ${destination} · ${etaLabel}`,
        title: `${hostile ? "Hostile" : "Third-party"} ${typeLabel.toLowerCase()} from ${attacker} returning home · ${etaLabel}`,
        direction: "outgoing",
        origin: "third-party",
        hostile,
        eta,
      };
    }
    const prefix = returning ? `Returning (${typeLabel})` : typeLabel;
    return {
      key: `${mission.missionId}-out`,
      label: `${prefix} → ${destination} · ${etaLabel}`,
      title: `Owner's own ${typeLabel.toLowerCase()} → ${destination} · ${etaLabel}`,
      direction: "outgoing",
      origin: "owner",
      hostile: false,
      eta,
    };
  }
  return null;
}

// True when the mission belongs to a different wallet than the planet's owner. Defaults to false (treat
// as owner-originated) when either wallet is missing so a line never falsely reads as a third party.
function isThirdPartyMission(planetOwner: string | null | undefined, missionOwner: string | null | undefined): boolean {
  if (!planetOwner || !missionOwner) return false;
  return planetOwner.toLowerCase() !== missionOwner.toLowerCase();
}

// Display name for the wallet that commands a mission. The origin planet of an inbound third-party
// fleet is the attacker's own planet, so its owner display name is the attacker; fall back to a short
// address when no name is indexed.
function missionOwnerName(mission: FleetMissionSummary): string {
  const displayName = mission.originPlanet?.ownerDisplayName?.trim();
  if (displayName) return displayName;
  return shortAddress(mission.owner);
}

// Coordinate label for one end of a mission, preferring the mission's resolved planet reference and
// falling back to a decoded colonization target (empty coordinates a Colonize fleet is heading to) or
// an opaque planet id when neither is available.
function missionEndpointCoordinatesLabel(mission: FleetMissionSummary, side: "origin" | "target"): string {
  const ref = side === "origin" ? mission.originPlanet : mission.targetPlanet;
  if (ref?.coordinates) return `[${ref.coordinates}]`;
  const planetId = side === "origin" ? mission.originPlanetId : mission.targetPlanetId;
  const colony = decodeColonizationTargetId(planetId);
  if (colony) return `[${colony.coordinates}]`;
  return `#${planetId}`;
}
