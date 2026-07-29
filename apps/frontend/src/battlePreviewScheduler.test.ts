import { describe, expect, test } from "bun:test";
import {
  forecastContractBattle,
  summarizeContractBattleForecast,
  type ContractBattleForecastSummary,
  type ContractBattleInput,
} from "./battlePreview";
import {
  BattlePreviewScheduler,
  battlePreviewInputKey,
  type BattlePreviewWorker,
  type BattlePreviewWorkerRequest,
  type BattlePreviewWorkerResponse,
} from "./battlePreviewScheduler";

const mixedFleetInput: ContractBattleInput = {
  attackers: [{
    id: "selected-attacker",
    label: "Selected attacking fleet",
    owner: "Connected commander",
    laneGroup: 0,
    ships: [8, 7, 6, 0, 5, 4, 3, 2, 1, 0, 1, 1, 1, 1, 0, 0],
    technology: { weapons: 1, shielding: 2, armor: 3 },
  }],
  defender: {
    id: "planet-168",
    label: "Target",
    owner: "0xdefender",
    ships: [3, 4, 0, 0, 2, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    defenses: [2, 2, 1, 1, 0, 0, 0, 0],
    technology: { weapons: 2, shielding: 2, armor: 2 },
    counterplay: [],
  },
};

const forecast = { probableOutcome: "draw", sampleCount: 128 } as ContractBattleForecastSummary;

describe("BattlePreviewScheduler", () => {
  test("returns a compact 128-sample result instead of cloning every sample to the UI", () => {
    const summary = summarizeContractBattleForecast(forecastContractBattle(mixedFleetInput));

    expect(summary.sampleCount).toBe(128);
    expect("samples" in summary).toBe(false);
    expect(summary.sampleReport.sampleId).toBeGreaterThan(0);
  });

  test("coalesces a rapid large-fleet edit burst into one simulation", () => {
    const timers = new ManualTimers();
    const workers: FakeWorker[] = [];
    const results: ContractBattleForecastSummary[] = [];
    const scheduler = new BattlePreviewScheduler({
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      debounceMs: 180,
      setTimer: timers.set,
      clearTimer: timers.clear,
    });

    for (let edit = 0; edit < 20; edit += 1) {
      const input = withReaperCount(mixedFleetInput, edit + 1);
      scheduler.schedule(battlePreviewInputKey(input), input, (result) => results.push(result), () => undefined);
    }

    expect(timers.pendingCount).toBe(1);
    expect(workers).toHaveLength(0);
    timers.runPending();
    expect(workers).toHaveLength(1);
    expect(workers[0]?.requests).toHaveLength(1);

    workers[0]?.respond({ requestId: workers[0].requests[0]?.requestId ?? -1, forecast });
    expect(results).toEqual([forecast]);
  });

  test("does not resimulate an unchanged fleet and target", () => {
    const timers = new ManualTimers();
    const workers: FakeWorker[] = [];
    const scheduler = schedulerWithFakes(timers, workers);
    const key = battlePreviewInputKey(mixedFleetInput);

    expect(scheduler.schedule(key, mixedFleetInput, () => undefined, () => undefined)).toBe(true);
    expect(scheduler.schedule(key, mixedFleetInput, () => undefined, () => undefined)).toBe(false);
    timers.runPending();

    expect(workers).toHaveLength(1);
    expect(workers[0]?.requests).toHaveLength(1);
  });

  test("terminates obsolete work and ignores a stale result", () => {
    const timers = new ManualTimers();
    const workers: FakeWorker[] = [];
    const results: string[] = [];
    const scheduler = schedulerWithFakes(timers, workers);
    const first = withReaperCount(mixedFleetInput, 1);
    const latest = withReaperCount(mixedFleetInput, 9);

    scheduler.schedule(battlePreviewInputKey(first), first, () => results.push("first"), () => undefined);
    timers.runPending();
    const staleWorker = workers[0];
    const staleRequestId = staleWorker?.requests[0]?.requestId ?? -1;

    scheduler.schedule(battlePreviewInputKey(latest), latest, () => results.push("latest"), () => undefined);
    expect(staleWorker?.terminated).toBe(true);
    staleWorker?.respond({ requestId: staleRequestId, forecast });
    expect(results).toEqual([]);

    timers.runPending();
    const latestWorker = workers[1];
    latestWorker?.respond({ requestId: latestWorker.requests[0]?.requestId ?? -1, forecast });
    expect(results).toEqual(["latest"]);
  });
});

class ManualTimers {
  private nextId = 1;
  private callbacks = new Map<number, () => void>();

  get pendingCount(): number {
    return this.callbacks.size;
  }

  set = (callback: () => void): ReturnType<typeof setTimeout> => {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, callback);
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  clear = (handle: ReturnType<typeof setTimeout>): void => {
    this.callbacks.delete(handle as unknown as number);
  };

  runPending(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback();
  }
}

class FakeWorker implements BattlePreviewWorker {
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<BattlePreviewWorkerResponse>) => void) | null = null;
  requests: BattlePreviewWorkerRequest[] = [];
  terminated = false;

  postMessage(request: BattlePreviewWorkerRequest): void {
    this.requests.push(request);
  }

  respond(response: BattlePreviewWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<BattlePreviewWorkerResponse>);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function schedulerWithFakes(timers: ManualTimers, workers: FakeWorker[]): BattlePreviewScheduler {
  return new BattlePreviewScheduler({
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    debounceMs: 180,
    setTimer: timers.set,
    clearTimer: timers.clear,
  });
}

function withReaperCount(input: ContractBattleInput, count: number): ContractBattleInput {
  const attacker = input.attackers[0]!;
  const ships = [...attacker.ships];
  ships[13] = count;
  return {
    ...input,
    attackers: [{ ...attacker, ships }],
  };
}
