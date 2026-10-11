import { forecastContractBattle, setActiveCombatModel, summarizeContractBattleForecast } from "./battlePreview";
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
    setActiveCombatModel(event.data.modelVersion);
    workerScope.postMessage({
      requestId,
      modelVersion: event.data.modelVersion,
      forecast: summarizeContractBattleForecast(forecastContractBattle(input, undefined, false)),
    });
  } catch (error) {
    workerScope.postMessage({
      requestId,
      modelVersion: event.data.modelVersion,
      error: error instanceof Error ? error.message : "Battle preview simulation failed.",
    });
  }
};
