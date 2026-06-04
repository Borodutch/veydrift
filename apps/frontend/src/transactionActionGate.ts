export type TransactionActionGate = {
  isRunning: (key: string) => boolean;
  run: <T>(key: string, action: () => Promise<T>) => Promise<T | undefined>;
};

export function createTransactionActionGate(): TransactionActionGate {
  const inFlight = new Set<string>();

  return {
    isRunning: (key) => inFlight.has(key),
    run: async (key, action) => {
      if (inFlight.has(key)) return undefined;

      inFlight.add(key);
      try {
        return await action();
      } finally {
        inFlight.delete(key);
      }
    },
  };
}

export function transactionAwaitingWalletLabel(label?: string): string {
  return label ? `${label}: awaiting wallet` : "Awaiting wallet";
}

export function transactionConfirmingLabel(label: string, txHash: string): string {
  return `${label}: submitted ${txHash.slice(0, 10)}...`;
}

export function transactionSyncingLabel(label: string): string {
  return `${label}: syncing indexed state...`;
}
