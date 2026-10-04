import type { FleetMissionSummary, Resources } from "./evm";

export type FleetEffect = {
  missionId: string; planetId: string; isMoon: boolean; at: number;
  leg: "arrival" | "return"; ships: Record<string, string>; cargo: Resources; terminal: boolean;
};
const zero = (): Resources => ({ metal: "0", crystal: "0", deuterium: "0" });

// Timers are not outcome proofs. In particular ships on an unresolved attack are
// launch ships, not survivors. Callers supply canonical return cargo/survivors.
export function deterministicFleetEffects(
  missions: readonly FleetMissionSummary[], now: number,
  bodyExists: (id: string, moon: boolean, owner?: string, mission?: FleetMissionSummary) => boolean | null,
  stagedLocks: ReadonlyMap<string, string> = new Map()
): FleetEffect[] {
  type Leg = { mission: FleetMissionSummary; planetId: string; isMoon: boolean; at: number; kind: number };
  const legs: Leg[] = [];
  for (const mission of missions) {
    if (!["Outbound", "Returning", "Recalled"].includes(mission.status)) continue;
    if (mission.status === "Outbound") legs.push({ mission, planetId: mission.targetPlanetId,
      isMoon: mission.targetIsMoon === true, at: Number(mission.defenseHoldUntil ?? mission.arrivalAt),
      kind: mission.missionType === "DefenseHold" ? 2 : 0 });
    if (mission.missionType !== "MissileAttack" && (mission.status !== "Outbound" || mission.missionType !== "Deploy" || (typeof mission.targetIsMoon !== "boolean" || (mission.targetIsMoon && bodyExists(mission.targetPlanetId, true, undefined, mission) !== true)))) {
      legs.push({ mission, planetId: mission.originPlanetId,
        isMoon: mission.originIsMoon === true && bodyExists(mission.originPlanetId, true, mission.owner, mission) !== false,
        at: Number(mission.returnAt), kind: 1 });
    }
  }
  legs.sort((a,b) => a.at-b.at || a.kind-b.kind || Number(BigInt(a.mission.missionId)-BigInt(b.mission.missionId)));
  const blocked = new Set<string>();
  const arrived = new Set<string>();
  const aborted = new Set<string>();
  const effects: FleetEffect[] = [];
  for (const leg of legs) {
    if (!Number.isSafeInteger(leg.at) || leg.at <= 0 || leg.at > now) continue;
    const m = leg.mission, body = leg.planetId + ":" + leg.isMoon;
    // An unproven origin incarnation can land on either the moon or parent.
    // Reserve both possible return surfaces before checking either surface lock.
    if (leg.kind === 1 && m.originIsMoon === true && bodyExists(leg.planetId, true, m.owner, m) === null) {
      blocked.add(leg.planetId + ":false"); blocked.add(leg.planetId + ":true"); continue;
    }
    if (blocked.has(body)) continue;
    // The staged combat lock is keyed by planet ID in the contract, unlike
    // ordinary chronology which distinguishes planet and moon surfaces.
    const lock = stagedLocks.get(leg.planetId);
    if (lock !== undefined && lock !== m.missionId) continue;
    // Unknown body flags may refer to either surface; reserve both rather than
    // letting a later moon event step around an unclassified earlier arrival.
    const bodyKnown = leg.kind === 1 ? typeof m.originIsMoon === "boolean" : typeof m.targetIsMoon === "boolean";
    if (!bodyKnown) { blocked.add(leg.planetId + ":false"); blocked.add(leg.planetId + ":true"); continue; }
    const transport = m.missionType === "Transport";
    const deploy = m.missionType === "Deploy";
    const arrival = leg.kind === 0 && m.status === "Outbound" && (transport || deploy);
    const peaceful = transport || deploy || m.missionType === "Harvest" || m.missionType === "Colonize";
    const knownReturn = leg.kind === 1 && (aborted.has(m.missionId) || arrived.has(m.missionId) || ((m.status === "Returning" || m.status === "Recalled") && (peaceful || !!m.survivingShips) && m.returnCargo !== null));
    // Missing body provenance is not permission to assume a planet. Replaced
    // moons cannot be proven from boolean flags alone; reject arrivals to them.
    const provenBody = leg.kind === 1 ? typeof m.originIsMoon === "boolean" : typeof m.targetIsMoon === "boolean";
    if (arrival && leg.isMoon && bodyExists(leg.planetId, true, undefined, m) === false) { aborted.add(m.missionId); continue; }
    if (!provenBody || (!arrival && !knownReturn) || !bodyExists(leg.planetId, leg.isMoon, leg.kind === 1 || deploy ? m.owner : undefined, m)) {
      blocked.add(body); continue;
    }
    if (arrival) arrived.add(m.missionId);
    effects.push({ missionId: m.missionId, planetId: leg.planetId, isMoon: leg.isMoon, at: leg.at,
      leg: arrival ? "arrival" : "return", ships: arrival && transport ? {} : !arrival && m.survivingShips ? m.survivingShips : m.ships,
      cargo: arrival || aborted.has(m.missionId) ? m.cargo : arrived.has(m.missionId) ? zero() : m.returnCargo ?? (m.status === "Recalled" ? m.cargo : zero()),
      terminal: !arrival || deploy });
  }
  return effects;
}
