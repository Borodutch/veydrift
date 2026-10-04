import { battleForecastUnavailableNotice } from "../playerNotice";
import { useVerifiedCombatModel } from "../combatModel";
import { emptyMissionShips } from "../galaxyActions";
import type { MissionDetailResponse } from "../walletFlow";
import { AttackOutcomePanel, preparePublicTargetBattleForecast, resolveVerifiedPublicTargetBattleForecast, type PreparedPublicTargetBattleForecast } from "./MissionCreationPage";

export function prepareMissionBattleForecast(detail: MissionDetailResponse, now: number): PreparedPublicTargetBattleForecast | null {
  const mission = detail.mission;
  if (detail.battleReport || mission.status !== "Outbound" || mission.recallProvenance === "FleetMissionRecalled"
    || !["Attack", "AcsAttack"].includes(mission.missionType)) return null;
  // Explicit null means the authoritative leader is no longer an active battle.
  if (detail.battleForecast === null) return null;
  const preview = detail.battleForecast;
  const uncertain = (message: string): PreparedPublicTargetBattleForecast => ({ status: "complete", forecast: {
    kind: "uncertain", label: "Uncertain", detail: message, attackerPower: 0, defenderPower: null,
  } });
  if (mission.combatResolutionProgress) return uncertain("Battle in progress. The report will appear when combat ends.");
  if (!preview) return uncertain("Battle intel is incomplete. The outcome cannot be estimated yet.");
  const asOf = Number(preview.asOf) * 1_000;
  const arrivalAt = Number(preview.arrivalAt) * 1_000;
  if (!Number.isFinite(asOf) || asOf <= 0 || now - asOf > 30_000 || asOf > now + 5_000) {
    return uncertain("Battle intel is updating. Check back shortly for an estimate.");
  }
  if (!Number.isFinite(arrivalAt) || arrivalAt <= now) {
    return uncertain("The fleet has reached its scheduled arrival. The battle outcome is not yet known.");
  }
  if (preview.unavailableReason) return uncertain(battleForecastUnavailableNotice());
  if (!preview.participants.length || !preview.participants.some(p => p.missionId === preview.leaderMissionId)) {
    return uncertain("The attacking fleet details are incomplete. The outcome cannot be estimated yet.");
  }
  return preparePublicTargetBattleForecast(
    emptyMissionShips(),
    preview.target ? { ...preview.target, occupiedBy: null } : undefined,
    preview.participants[0]?.combatTechnology,
    preview.targetIsMoon,
    { participants: preview.participants, stationedDefenders: preview.stationedDefenders, selectedAttackerLaneGroup: null, existingBattle: true },
    { projectedAttackArrivalAt: Number(preview.arrivalAt) },
  );
}

export function MissionBattleForecastPanel({ detail, now }: { detail: MissionDetailResponse; now: number }) {
  const verified = useVerifiedCombatModel();
  return renderMissionBattleForecastPanel({ detail, now }, verified);
}

export function renderMissionBattleForecastPanel({ detail, now }: { detail: MissionDetailResponse; now: number }, verified: boolean) {
  const prepared = prepareMissionBattleForecast(detail, now);
  if (!prepared) return null;
  const forecast = resolveVerifiedPublicTargetBattleForecast(prepared, verified);
  const preview = detail.battleForecast;
  return <section className="grid gap-2 rounded-md border border-white/10 bg-black/15 p-3" aria-label="Probable outcome">
    <h2 className="text-sm font-semibold text-slate-200">Probable outcome</h2>
    {preview ? <p className="text-xs text-slate-400">Shared battle #{preview.leaderMissionId} · {preview.participants.length} attacking fleets · {preview.stationedDefenders.length} supporting defenders</p> : null}
    <p className="text-xs text-slate-400">Current public intel, refreshed automatically. Participants, technology and target forces may change before impact. Simulations are estimates, not guaranteed casualties or loot.</p>
    <AttackOutcomePanel battleForecast={forecast} />
    {prepared.status === "simulate" ? <div className="grid gap-1 text-xs text-slate-400">
      {prepared.input.attackers.map(participant => <div key={participant.id}>{participant.label} · W {participant.technology.weapons} / S {participant.technology.shielding} / A {participant.technology.armor}</div>)}
      {prepared.input.defender.counterplay?.map(participant => <div key={participant.id}>{participant.label} · W {participant.technology.weapons} / S {participant.technology.shielding} / A {participant.technology.armor}</div>)}
    </div> : null}
  </section>;
}
