import type {
  ChainInfrastructureState,
  PlayerQueuesResponse,
  WalletSettlementResponse,
} from "./walletFlow";

export type FinishedBuildingExpectation = {
  itemId?: number | undefined;
  targetLevel?: number | undefined;
};

export type FinishedBuildingSnapshot = {
  infrastructure: ChainInfrastructureState;
  queues: PlayerQueuesResponse;
  settlement: WalletSettlementResponse;
};

type WaitOptions = {
  attempts?: number;
  intervalMs?: number;
  delay?: (ms: number) => Promise<void>;
};

export function isFinishedBuildingStateVisible(
  snapshot: Pick<FinishedBuildingSnapshot, "infrastructure" | "queues">,
  expectation: FinishedBuildingExpectation,
): boolean {
  const queueCleared = !snapshot.queues.building?.active && !snapshot.infrastructure.queue?.active;
  if (!queueCleared) return false;

  if (expectation.itemId === undefined || expectation.targetLevel === undefined) {
    return true;
  }

  const row = snapshot.infrastructure.buildings.find((building) => building.id === expectation.itemId);
  return (row?.level ?? 0) >= expectation.targetLevel;
}

export async function waitForFinishedBuildingState(
  load: () => Promise<FinishedBuildingSnapshot>,
  expectation: FinishedBuildingExpectation,
  options: WaitOptions = {},
): Promise<FinishedBuildingSnapshot> {
  const attempts = options.attempts ?? 8;
  const intervalMs = options.intervalMs ?? 1_500;
  const delay = options.delay ?? defaultDelay;
  let latest: FinishedBuildingSnapshot | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await load();
    if (isFinishedBuildingStateVisible(latest, expectation)) {
      return latest;
    }

    if (attempt < attempts - 1) {
      await delay(intervalMs);
    }
  }

  return latest ?? load();
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
