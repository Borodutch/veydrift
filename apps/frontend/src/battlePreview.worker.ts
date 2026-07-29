import { forecastContractBattle, summarizeContractBattleForecast } from "./battlePreview";
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
    workerScope.postMessage({
      requestId,
      forecast: summarizeContractBattleForecast(forecastContractBattle(input)),
    });
  } catch (error) {
    workerScope.postMessage({
      requestId,
      error: error instanceof Error ? error.message : "Battle preview simulation failed.",
    });
  }
};
