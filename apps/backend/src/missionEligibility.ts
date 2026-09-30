import type { ChainReader, FleetMissionSummary } from "./evm";

export type MissionResolutionLeg = "arrival" | "return";
type EligibilityReader = Pick<ChainReader, "canResolveFleetMission">;

export function missionEligibilityPath(path: string): boolean {
  return path === "/missions"
    || new RegExp("^/mission/[^/]+$").test(path)
    || new RegExp("^/wallet/[^/]+/(fleet-visibility|overview|missions)$").test(path);
}

// These are the mission-bearing fields in the public response schemas, not arbitrary recursive JSON.
function responseMissions(payload: Record<string, unknown>): FleetMissionSummary[] {
  const missions: FleetMissionSummary[] = [];
  if (payload.mission && typeof payload.mission === "object") missions.push(payload.mission as FleetMissionSummary);
  for (const key of ["missions", "incoming", "outgoing", "returning", "joinableAttacks", "joinableDefenses", "completedMissions"]) {
    if (Array.isArray(payload[key])) missions.push(...payload[key] as FleetMissionSummary[]);
  }
  if (Array.isArray(payload.rows)) {
    for (const row of payload.rows as Array<{ mission?: FleetMissionSummary }>) {
      if (row.mission) missions.push(row.mission);
    }
  }
  if (payload.fleetVisibility && typeof payload.fleetVisibility === "object") {
    missions.push(...responseMissions(payload.fleetVisibility as Record<string, unknown>));
  }
  return missions;
}

// Eligibility is an ephemeral chain fact. Never infer it from the viewer's partial fleet feed:
// an earlier event can belong to another player, and randomness/hold state can change independently.
export async function applyMissionEligibility(
  payload: Record<string, unknown>,
  reader: EligibilityReader | undefined,
  nowSeconds = Math.floor(Date.now() / 1_000),
  deadlineMs = 1_500
): Promise<void> {
  const candidates = new Map<string, { leg: MissionResolutionLeg; missions: FleetMissionSummary[] }>();
  for (const mission of responseMissions(payload)) {
    mission.needsResolution = false;
    mission.resolutionEligible = false;
    const leg = mission.status === "Outbound" ? "arrival"
      : mission.status === "Returning" || mission.status === "Recalled" ? "return" : null;
    if (!leg || !/^\d+$/.test(mission.missionId)) continue;
    const dueAt = Number(leg === "return" ? mission.returnAt
      : mission.missionType === "DefenseHold" ? mission.defenseHoldUntil ?? mission.returnAt : mission.arrivalAt);
    if (!Number.isFinite(dueAt) || dueAt <= 0 || dueAt > nowSeconds) continue;
    const key = mission.missionId + ":" + leg;
    const existing = candidates.get(key);
    if (existing) existing.missions.push(mission);
    else candidates.set(key, { leg, missions: [mission] });
  }
  if (!reader?.canResolveFleetMission) return;
  // Bound RPC work for public/global responses. Overflow remains fail-closed; the detail endpoint
  // checks a single mission. Four in flight avoids an unbounded RPC fan-out from global mission lists.
  const pending = [...candidates.values()].slice(0, 64);
  let next = 0;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>(resolve => {
    timer = setTimeout(() => { expired = true; resolve(); }, deadlineMs);
  });
  const checks = Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (!expired && next < pending.length) {
      const candidate = pending[next++]!;
      let eligible = false;
      try {
        eligible = await reader.canResolveFleetMission!(BigInt(candidate.missions[0]!.missionId), candidate.leg);
      } catch { /* Missing state, reverts and RPC failures must never advertise readiness. */ }
      if (expired) return;
      for (const mission of candidate.missions) {
        mission.resolutionEligible = eligible;
        mission.needsResolution = eligible && candidate.leg === "arrival";
      }
    }
  }));
  // A slow node may hide the action, never stall the whole mission/overview response. In-flight
  // calls retain their transport deadlines; no further work or late response mutation is allowed.
  try { await Promise.race([checks, deadline]); }
  finally { clearTimeout(timer); }
}
