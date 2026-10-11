import { addBattleRun, deterministicBattleSampleWord, emptyBattleStats, runContractBattle, setActiveCombatModel } from "./battlePreview";
import type { BattleSimulationMessage, BattleSimulationRequest } from "./battleSimulation";

type Scope = {
  onmessage: ((event: MessageEvent<BattleSimulationRequest>) => void) | null;
  postMessage: (message: BattleSimulationMessage) => void;
};
const scope = self as unknown as Scope;

// Runs fixed seeds in order, so the first N runs are identical everywhere; only the run count can
// differ when a large battle hits the time budget. Progress is posted while the loop keeps going.
scope.onmessage = ({ data }) => {
  try {
    setActiveCombatModel(data.modelVersion);
    const stats = emptyBattleStats(data.input);
    const started = performance.now();
    let posted = started;
    for (let index = 0; index < data.runs; index++) {
      addBattleRun(stats, runContractBattle(data.input, deterministicBattleSampleWord(index), index + 1, false, true), true);
      const now = performance.now();
      if (stats.runs >= data.minRuns && now - started > data.budgetMs) break;
      if (now - posted > 200) {
        scope.postMessage({ stats, done: false });
        posted = now;
      }
    }
    scope.postMessage({ stats, done: true });
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : "The battle simulation failed." });
  }
};
