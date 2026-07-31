import { runContractBattle, type ContractBattleInput, type ContractBattleResult } from "./battlePreview";

type BattleReportWorkerRequest = {
  input: ContractBattleInput;
  randomWord: `0x${string}`;
  requestId: number;
  sampleId: number;
};

type BattleReportWorkerResponse =
  | { report: ContractBattleResult; requestId: number }
  | { error: string; requestId: number };

type BattleReportWorkerScope = {
  onmessage: ((event: MessageEvent<BattleReportWorkerRequest>) => void) | null;
  postMessage: (response: BattleReportWorkerResponse) => void;
};

const workerScope = self as unknown as BattleReportWorkerScope;

workerScope.onmessage = (event) => {
  const { input, randomWord, requestId, sampleId } = event.data;
  try {
    workerScope.postMessage({
      report: runContractBattle(input, randomWord, sampleId),
      requestId,
    });
  } catch (error) {
    workerScope.postMessage({
      error: error instanceof Error ? error.message : "Battle report simulation failed.",
      requestId,
    });
  }
};
