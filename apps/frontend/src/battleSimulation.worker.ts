import { runBattleSimulation, setActiveCombatModel } from "./battlePreview";
import type { BattleSimulationMessage, BattleSimulationRequest } from "./battleSimulation";

type Scope = {
  onmessage: ((event: MessageEvent<BattleSimulationRequest>) => void) | null;
  postMessage: (message: BattleSimulationMessage) => void;
};
const scope = self as unknown as Scope;

// Progress is posted while the loop keeps going.
scope.onmessage = ({ data }) => {
  try {
    setActiveCombatModel(data.modelVersion);
    const stats = runBattleSimulation(data.input, data, (progress) => scope.postMessage({ stats: progress, done: false }));
    scope.postMessage({ stats, done: true });
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : "The battle simulation failed." });
  }
};
