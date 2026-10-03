import { CONTRACT_COMBAT_MODEL_VERSION, runContractBattle, type ContractBattleInput, type ContractBattleResult } from "./battlePreview";

type BattleReportWorkerRequest = {
  input: ContractBattleInput;
  randomWord: `0x${string}`;
  requestId: number;
  sampleId: number;
  modelVersion: number;
};

type BattleReportWorkerResponse =
  | { report: ContractBattleResult; requestId: number; modelVersion: number }
  | { error: string; requestId: number; modelVersion: number };

type BattleReportWorkerScope = {
  onmessage: ((event: MessageEvent<BattleReportWorkerRequest>) => void) | null;
  postMessage: (response: BattleReportWorkerResponse) => void;
};

const workerScope = self as unknown as BattleReportWorkerScope;

workerScope.onmessage = (event) => {
  const { input, randomWord, requestId, sampleId } = event.data;
  try {
    if (event.data.modelVersion !== CONTRACT_COMBAT_MODEL_VERSION) throw new Error("Battle model mismatch");
    workerScope.postMessage({
      report: runContractBattle(input, randomWord, sampleId),
      requestId,
      modelVersion: CONTRACT_COMBAT_MODEL_VERSION,
    });
  } catch (error) {
    workerScope.postMessage({
      error: error instanceof Error ? error.message : "Battle report simulation failed.",
      requestId,
      modelVersion: CONTRACT_COMBAT_MODEL_VERSION,
    });
  }
};
