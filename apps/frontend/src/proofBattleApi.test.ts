import { expect, test } from "bun:test";
import type { ProofBattleProgress } from "../../../packages/api-types/src/index";
import { fetchMission, fetchGlobalMissionArchive, type FleetMissionSummary } from "./walletFlow";

test("mission detail and archive preserve optional shared proof status without inventing report or round data", async () => {
  const original = globalThis.fetch;
  const statuses: Array<ProofBattleProgress | undefined> = [undefined,
    { state: "preparing", stagedPhase: 2 }, { state: "randomness-wait", stagedPhase: 16 },
    { state: "proving", stagedPhase: 17 }, { state: "applying", stagedPhase: 17, nextIndex: "9007199254740993", memberCount: "9007199254740994" },
    { state: "economics", stagedPhase: 11 }, { state: "unavailable", stagedPhase: 17 }];
  try {
    for (const status of statuses) {
      const progress: Pick<FleetMissionSummary, "proofBattleProgress"> = status ? { proofBattleProgress: status } : {};
      const mission = { missionId: "44", status: "Outbound", ...progress };
      globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => new Response(JSON.stringify(
        String(input).includes("/missions?") ? { rows: [{ kind: "mission", mission }], pagination: {} } : { mission, battleReport: null }
      ), { headers: { "content-type": "application/json" } })) as typeof fetch;
      const detail = await fetchMission("https://proof.invalid", "44");
      expect(detail.mission.proofBattleProgress).toEqual(status);
      expect(detail.mission.combatResolutionProgress).toBeUndefined();
      expect(detail.battleReport).toBeNull();
      const archive = await fetchGlobalMissionArchive("https://proof.invalid", { page: 1, pageSize: 10 });
      const entry = archive.rows[0]!;
      expect(entry.kind).toBe("mission");
      if (entry.kind === "mission") expect(entry.mission.proofBattleProgress).toEqual(status);
    }
  } finally { globalThis.fetch = original; }
});
