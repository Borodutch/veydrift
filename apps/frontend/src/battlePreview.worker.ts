import { CONTRACT_COMBAT_MODEL_VERSION, forecastContractBattle, summarizeContractBattleForecast } from "./battlePreview";
import type {
  BattlePreviewWorkerRequest,
  BattlePreviewWorkerResponse,
} from "./battlePreviewScheduler";

type BattlePreviewWorkerScope = {
  onmessage: ((event: MessageEvent<BattlePreviewWorkerRequest>) => void) | null;
  postMessage: (response: BattlePreviewWorkerResponse) => void;
};

const workerScope = self as unknown as BattlePreviewWorkerScope;

workerScope.onmessage = (event) => {
  const { input, requestId } = event.data;
  try {
    if (event.data.modelVersion !== CONTRACT_COMBAT_MODEL_VERSION) throw new Error("Battle model mismatch");
    workerScope.postMessage({
      requestId,
      modelVersion: CONTRACT_COMBAT_MODEL_VERSION,
      forecast: summarizeContractBattleForecast(forecastContractBattle(input, undefined, false)),
    });
  } catch (error) {
    workerScope.postMessage({
      requestId,
      modelVersion: CONTRACT_COMBAT_MODEL_VERSION,
      error: error instanceof Error ? error.message : "Battle preview simulation failed.",
    });
  }
};
