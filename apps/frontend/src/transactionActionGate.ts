export type TransactionActionGate = {
  isRunning: (key?: string) => boolean;
  run: <T>(key: string, action: () => Promise<T>) => Promise<T | undefined>;
};

export type WriteTransactionPhase = "idle" | "pending" | "confirming" | "confirmed" | "indexing" | "applied" | "success" | "error";

/**
 * A submitted hash remains Processing until the backend reports it applied. Only a
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
  phase: WriteTransactionPhase;
  txHash?: string | undefined;
};

/** Derive semantic outcome from the one stored lifecycle phase. */
export function transactionStateOutcome(state: Pick<WriteTransactionState, "phase" | "txHash"> | undefined): WriteTransactionOutcomeKind | undefined {
  if (!state || state.phase === "idle") return undefined;
  switch (state.phase) {
    case "pending": return "not-submitted";
    case "confirming": return "submitted";
    case "confirmed":
    case "indexing": return "confirmed";
    case "applied":
    case "success": return "indexed";
    case "error": return state.txHash ? "reverted" : "not-submitted";
  }
}

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
