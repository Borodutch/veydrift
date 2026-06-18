export type TransactionActionGate = {
  isRunning: (key?: string) => boolean;
  run: <T>(key: string, action: () => Promise<T>) => Promise<T | undefined>;
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

export function transactionAwaitingWalletLabel(label?: string): string {
  return label ? `${label}: awaiting wallet` : "Awaiting wallet";
}

export function transactionConfirmingLabel(label: string, txHash: string): string {
  return `${label}: submitted ${txHash.slice(0, 10)}...`;
}

export function transactionSyncingLabel(label: string): string {
  return `${label}: syncing indexed state...`;
}
