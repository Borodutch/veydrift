export type TransactionActionGate = {
  isRunning: (key?: string) => boolean;
  run: <T>(key: string, action: () => Promise<T>) => Promise<T | undefined>;
};

export type WriteTransactionPhase = "idle" | "pending" | "confirming" | "confirmed" | "indexing" | "success" | "error";

/**
 * The canonical write outcome is deliberately independent from the visual
 * phase. A delayed indexed read may put the UI in an error-looking phase for
 * legacy consumers, but a transaction hash still proves that it was submitted
 * and must never be presented as "not sent".
 */
export type WriteTransactionOutcomeKind = "not-submitted" | "submitted" | "confirmed" | "indexed" | "reverted";

export type WriteTransactionOutcome = {
  error?: unknown;
  outcome: WriteTransactionOutcomeKind;
  txHash?: string | undefined;
};

export type WriteTransactionState = {
  error?: unknown;
  key?: string;
  label?: string;
  outcome?: WriteTransactionOutcomeKind;
  phase: WriteTransactionPhase;
  stage?: "wallet" | "confirmed" | "waiting-for-index" | "applied" | "timed-out" | "failed";
  txHash?: string | undefined;
};

export type WriteTransactionDescriptor<IndexedSnapshot = void> = {
  applyIndexedState?: (snapshot: IndexedSnapshot) => Promise<void> | void;
  confirm: (txHash: string) => Promise<unknown>;
  errorLabel?: (error: unknown) => string;
  key: string;
  label: string;
  /**
   * A receipt can be final even when the indexed API has not caught up before
   * this action's bounded wait expires.  Let the data owner invalidate the
   * affected snapshots in that case so a confirmed write never leaves a view
   * presenting its pre-transaction data as fresh.
   */
  onConfirmedIndexingFailure?: (error: unknown, txHash: string) => Promise<void> | void;
  onErrorRefresh?: (error: unknown) => Promise<void> | void;
  onStateChange?: (state: WriteTransactionState) => void;
  /**
   * Optional wallet/API preparation that must share the same global write
   * gate as submission (for example an authorization signature).  It never
   * reconciles state; post-receipt indexing remains in waitForIndexed.
   */
  prepare?: () => Promise<void>;
  send: () => Promise<string>;
  waitForIndexed?: (receipt: unknown, txHash: string) => Promise<IndexedSnapshot>;
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

export async function runWriteTransaction<IndexedSnapshot = void>(gate: TransactionActionGate, descriptor: WriteTransactionDescriptor<IndexedSnapshot>): Promise<WriteTransactionOutcome> {
  let outcome: WriteTransactionOutcome = { outcome: "not-submitted" };
  let didRun = false;
  const result = await gate.run(descriptor.key, async () => {
    didRun = true;
    const setState = (state: WriteTransactionState) => descriptor.onStateChange?.(state);
    setState({
      key: descriptor.key,
      outcome: "not-submitted",
      phase: "pending",
      stage: "wallet",
      label: transactionAwaitingWalletLabel(descriptor.label),
    });

    let txHash: string | undefined;
    let receiptConfirmed = false;
    try {
      await descriptor.prepare?.();
      txHash = await descriptor.send();
      setState({
        key: descriptor.key,
        outcome: "submitted",
        phase: "confirming",
        stage: "wallet",
        label: transactionConfirmingLabel(descriptor.label, txHash),
        txHash,
      });
      const receipt = await descriptor.confirm(txHash);
      receiptConfirmed = true;
      setState({
        key: descriptor.key,
        outcome: "confirmed",
        phase: "confirmed",
        stage: "confirmed",
        label: transactionConfirmedLabel(descriptor.label),
        txHash,
      });
      setState({
        key: descriptor.key,
        outcome: "confirmed",
        phase: "indexing",
        stage: "waiting-for-index",
        label: transactionSyncingLabel(descriptor.label),
        txHash,
      });
      const snapshot = descriptor.waitForIndexed ? await descriptor.waitForIndexed(receipt, txHash) : undefined;
      if (descriptor.applyIndexedState) {
        await descriptor.applyIndexedState(snapshot as IndexedSnapshot);
      }
      setState({
        key: descriptor.key,
        outcome: "indexed",
        phase: "success",
        stage: "applied",
        label: `${descriptor.label} confirmed.`,
        txHash,
      });
      outcome = { outcome: "indexed", txHash };
    } catch (error) {
      if (receiptConfirmed && txHash) {
        await descriptor.onConfirmedIndexingFailure?.(error, txHash);
      }
      await descriptor.onErrorRefresh?.(error);
      // Once a hash exists, a bounded backend-status timeout is a delayed
      // outcome whether or not the receipt phase was observed first. The
      // durable store journal keeps retry recovery authoritative and blocks an
      // unsafe duplicate submission.
      const indexingTimedOut = Boolean(txHash) && isTransactionIndexingTimeout(error);
      const failedOutcome = transactionFailureOutcome(error, txHash, receiptConfirmed);
      outcome = { error, outcome: failedOutcome, txHash };
      setState({
        error,
        key: descriptor.key,
        outcome: failedOutcome,
        phase: "error",
        stage: indexingTimedOut ? "timed-out" : "failed",
        label: failedOutcome === "confirmed"
          ? transactionSyncingLabel(descriptor.label)
          : failedOutcome === "submitted"
            ? transactionConfirmingLabel(descriptor.label, txHash!)
            : descriptor.errorLabel?.(error) ?? (error instanceof Error ? error.message : `${descriptor.label} failed.`),
        txHash,
      });
    }
  });

  return result === undefined && !didRun ? { outcome: "not-submitted" } : outcome;
}

export function writeTransactionOutcomeFromState(
  state: WriteTransactionState | undefined,
  fallbackTxHash?: string | undefined,
): WriteTransactionOutcome {
  const txHash = state?.txHash ?? fallbackTxHash;
  if (state?.outcome) return { error: state.error, outcome: state.outcome, txHash };
  if (state?.phase === "success") return { outcome: "indexed", txHash };
  return { error: state?.error, outcome: txHash ? "submitted" : "not-submitted", txHash };
}

function transactionFailureOutcome(
  error: unknown,
  txHash: string | undefined,
  receiptConfirmed: boolean,
): WriteTransactionOutcomeKind {
  if (!txHash) return "not-submitted";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/transaction reverted|\breverted\b/i.test(message)) return "reverted";
  return receiptConfirmed ? "confirmed" : "submitted";
}

export function isTransactionIndexingTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /timed?\s*out|still syncing|index(?:ed|ing).*unavailable|syncing indexed state/i.test(message);
}

export function transactionAwaitingWalletLabel(label?: string): string {
  return label ? `${label}: awaiting wallet` : "Awaiting wallet";
}

export function transactionConfirmingLabel(label: string, txHash: string): string {
  return `${label}: submitted ${txHash.slice(0, 10)}...`;
}

export function transactionConfirmedLabel(label: string): string {
  return `${label}: confirmed. Waiting for indexed state...`;
}

export function transactionSyncingLabel(label: string): string {
  return `${label}: syncing indexed state...`;
}
