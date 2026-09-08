export type TransactionActionGate = {
  isRunning: (key?: string) => boolean;
  run: <T>(key: string, action: () => Promise<T>) => Promise<T | undefined>;
};

export type WriteTransactionPhase = "idle" | "pending" | "confirming" | "confirmed" | "indexing" | "success" | "error";

/**
 * A submitted hash remains Processing until indexed refresh succeeds. Only a
 * reverted receipt is a post-submission failure, never a transport timeout.
 */
export type WriteTransactionOutcomeKind = "not-submitted" | "submitted" | "confirmed" | "indexed" | "reverted";

export type WriteTransactionOutcome = {
  error?: unknown;
  outcome: WriteTransactionOutcomeKind;
  txHash?: string | undefined;
};

export type WriteTransactionState = {
  planetId?: string;
  error?: unknown;
  key?: string;
  label?: string;
  outcome?: WriteTransactionOutcomeKind;
  phase: WriteTransactionPhase;
  stage?: "wallet" | "confirmed" | "waiting-for-index" | "applied" | "failed";
  txHash?: string | undefined;
};


export function createTransactionActionGate(): TransactionActionGate {
  let inFlightKey: string | undefined;

  return {
    isRunning: (key) => (key ? inFlightKey === key : inFlightKey !== undefined),
    run: async (key, action) => {
      if (inFlightKey) return undefined;

      inFlightKey = key;
      try {
        return await action();
      } finally {
        inFlightKey = undefined;
      }
    },
  };
}


export function transactionAwaitingWalletLabel(label?: string): string {
  return label ? `${label}: awaiting wallet` : "Awaiting wallet";
}


export function transactionSyncingLabel(label: string): string {
  return `${label}: Processing…`;
}
