export type TransactionActionGate = {
  isRunning: (key?: string) => boolean;
  run: <T>(key: string, action: () => Promise<T>) => Promise<T | undefined>;
};

export type WriteTransactionPhase =
  | "idle"
  | "pending"
  | "confirming"
  | "confirmed"
  | "indexing"
  | "success"
  | "error";

export type WriteTransactionState = {
  error?: unknown;
  label?: string;
  phase: WriteTransactionPhase;
  txHash?: string;
};

export type WriteTransactionDescriptor<IndexedSnapshot = void> = {
  applyIndexedState?: (snapshot: IndexedSnapshot) => Promise<void> | void;
  confirm: (txHash: string) => Promise<unknown>;
  errorLabel?: (error: unknown) => string;
  key: string;
  label: string;
  onErrorRefresh?: (error: unknown) => Promise<void> | void;
  onStateChange?: (state: WriteTransactionState) => void;
  send: () => Promise<string>;
  waitForIndexed?: (receipt: unknown, txHash: string) => Promise<IndexedSnapshot>;
};

export function createTransactionActionGate(): TransactionActionGate {
  let inFlightKey: string | undefined;

  return {
    isRunning: (key) => key ? inFlightKey === key : inFlightKey !== undefined,
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

export async function runWriteTransaction<IndexedSnapshot = void>(
  gate: TransactionActionGate,
  descriptor: WriteTransactionDescriptor<IndexedSnapshot>,
): Promise<boolean> {
  let completed = false;
  let didRun = false;
  const result = await gate.run(descriptor.key, async () => {
    didRun = true;
    const setState = (state: WriteTransactionState) => descriptor.onStateChange?.(state);
    setState({ phase: "pending", label: transactionAwaitingWalletLabel(descriptor.label) });

    try {
      const txHash = await descriptor.send();
      setState({ phase: "confirming", label: transactionConfirmingLabel(descriptor.label, txHash), txHash });
      const receipt = await descriptor.confirm(txHash);
      setState({ phase: "confirmed", label: transactionConfirmedLabel(descriptor.label), txHash });
      setState({ phase: "indexing", label: transactionSyncingLabel(descriptor.label), txHash });
      const snapshot = descriptor.waitForIndexed ? await descriptor.waitForIndexed(receipt, txHash) : undefined;
      if (descriptor.applyIndexedState) {
        await descriptor.applyIndexedState(snapshot as IndexedSnapshot);
      }
      setState({ phase: "success", label: `${descriptor.label} confirmed.`, txHash });
      completed = true;
    } catch (error) {
      await descriptor.onErrorRefresh?.(error);
      setState({
        error,
        phase: "error",
        label: descriptor.errorLabel?.(error) ?? (error instanceof Error ? error.message : `${descriptor.label} failed.`),
      });
    } finally {
      setState({ phase: "idle" });
    }
  });

  return result === undefined && !didRun ? false : completed;
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
