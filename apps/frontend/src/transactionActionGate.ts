export type TransactionActionGate = {
  isRunning: (key?: string) => boolean;
  run: <T>(key: string, action: () => Promise<T>) => Promise<T | undefined>;
};

export type WriteTransactionPhase = "idle" | "preparing" | "pending" | "unknown" | "confirming" | "confirmed" | "indexing" | "applied" | "success" | "error";

/**
 * A submitted hash remains Processing until the backend reports it applied. Only a
 * reverted receipt is a post-submission failure, never a transport timeout.
 */
export type WriteTransactionOutcomeKind = "not-submitted" | "unknown" | "submitted" | "confirmed" | "indexed" | "reverted";

export type WriteTransactionOutcome = {
  error?: unknown;
  outcome: WriteTransactionOutcomeKind;
  txHash?: string | undefined;
};

export type WriteTransactionState = {
  attemptId?: number;
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
    case "preparing": return "not-submitted";
    case "unknown": return "unknown";
    case "pending": return "not-submitted";
    case "confirming": return "submitted";
    case "confirmed":
    case "indexing": return "confirmed";
    case "applied":
    case "success": return "indexed";
    case "error": return state.txHash ? "reverted" : "not-submitted";
  }
}

export function transactionWasSubmitted(outcome: WriteTransactionOutcomeKind | undefined): boolean {
  return outcome === "submitted" || outcome === "confirmed" || outcome === "indexed";
}

export function transactionIsBusy(state: WriteTransactionState | undefined): boolean {
  return state?.phase === "preparing" || state?.phase === "pending";
}

/** Only called after the user explicitly tries the same uncertain action again. */
export function confirmTransactionRetry(): boolean {
  return typeof window !== "undefined" && window.confirm("The previous request has not been confirmed. Check your wallet activity first. Sending again could duplicate it. Send another request?");
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
