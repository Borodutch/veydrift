import type { ContractBattleForecastSummary, ContractBattleInput } from "./battlePreview";

export const ATTACK_BATTLE_PREVIEW_DEBOUNCE_MS = 180;

export type BattlePreviewWorkerRequest = {
  requestId: number;
  input: ContractBattleInput;
};

export type BattlePreviewWorkerResponse =
  | {
      requestId: number;
      forecast: ContractBattleForecastSummary;
    }
  | {
      requestId: number;
      error: string;
    };

export type BattlePreviewWorker = {
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<BattlePreviewWorkerResponse>) => void) | null;
  postMessage: (request: BattlePreviewWorkerRequest) => void;
  terminate: () => void;
};

type TimerHandle = ReturnType<typeof setTimeout>;

export type BattlePreviewSchedulerOptions = {
  createWorker: () => BattlePreviewWorker;
  debounceMs?: number;
  setTimer?: (callback: () => void, delay: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
};

/**
 * Debounces preview requests before they reach a worker and owns exactly one
 * worker at a time. Replacing a request terminates in-flight simulation so a
 * rapid edit burst cannot build a many-seconds-long worker queue.
 */
export class BattlePreviewScheduler {
  private readonly createWorker: () => BattlePreviewWorker;
  private readonly debounceMs: number;
  private readonly setTimer: (callback: () => void, delay: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;
  private activeRequestId = 0;
  private lastKey: string | undefined;
  private timer: TimerHandle | undefined;
  private worker: BattlePreviewWorker | undefined;

  constructor({
    createWorker,
    debounceMs = ATTACK_BATTLE_PREVIEW_DEBOUNCE_MS,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }: BattlePreviewSchedulerOptions) {
    this.createWorker = createWorker;
    this.debounceMs = debounceMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
  }

  schedule(
    key: string,
    input: ContractBattleInput,
    onResult: (forecast: ContractBattleForecastSummary) => void,
    onError: (error: string) => void,
  ): boolean {
    if (key === this.lastKey) return false;

    this.cancelActive();
    this.lastKey = key;
    const requestId = this.activeRequestId;
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      if (requestId !== this.activeRequestId) return;

      try {
        const worker = this.createWorker();
        this.worker = worker;
        worker.onmessage = (event) => {
          if (requestId !== this.activeRequestId || event.data.requestId !== requestId) return;
          this.finishWorker(worker);
          if ("forecast" in event.data) {
            onResult(event.data.forecast);
          } else {
            onError(event.data.error);
          }
        };
        worker.onerror = () => {
          if (requestId !== this.activeRequestId) return;
          this.finishWorker(worker);
          onError("The battle preview worker failed.");
        };
        worker.postMessage({ requestId, input });
      } catch (error) {
        if (requestId === this.activeRequestId) {
          onError(error instanceof Error ? error.message : "The battle preview worker could not start.");
        }
      }
    }, this.debounceMs);
    return true;
  }

  reset(): void {
    this.cancelActive();
    this.lastKey = undefined;
  }

  dispose(): void {
    this.reset();
  }

  private cancelActive(): void {
    this.activeRequestId += 1;
    if (this.timer !== undefined) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = undefined;
    }
  }

  private finishWorker(worker: BattlePreviewWorker): void {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    if (this.worker === worker) this.worker = undefined;
  }
}

export function battlePreviewInputKey(input: ContractBattleInput): string {
  return JSON.stringify(input);
}
