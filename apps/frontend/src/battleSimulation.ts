import { useEffect, useState } from "preact/hooks";
import type { BattleSimulationLimits, BattleStats, ContractBattleInput } from "./battlePreview";

export type BattleSimulationRequest = BattleSimulationLimits & {
  input: ContractBattleInput;
  modelVersion: number;
};
export type BattleSimulationMessage = { stats: BattleStats; done: boolean } | { error: string };

/** Stats always belong to `input` and `modelVersion`; while a new input runs, the previous result stays visible. */
export type BattleSimulation =
  | { status: "idle" }
  | { status: "running"; input: ContractBattleInput; modelVersion: number; stats: BattleStats | null }
  | { status: "done"; input: ContractBattleInput; modelVersion: number; stats: BattleStats }
  | { status: "error"; error: string };

// Small battles finish all runs instantly; large ones stop after the time budget once MIN_RUNS are
// done, and huge ones (where MIN_RUNS alone would take minutes) after MAX_MS regardless.
const RUNS = 1_000;
const MIN_RUNS = 100;
const BUDGET_MS = 4_000;
const MAX_MS = 8_000;
const DEBOUNCE_MS = 250;
const FAILED = "The battle simulation failed. Please retry.";

export function useBattleSimulation(input: ContractBattleInput | null, modelVersion: number): BattleSimulation {
  const key = input ? JSON.stringify([modelVersion, input]) : null;
  const [state, setState] = useState<BattleSimulation>({ status: "idle" });
  useEffect(() => {
    if (!input) {
      setState({ status: "idle" });
      return undefined;
    }
    setState((current) => current.status === "running" || current.status === "done"
      ? { status: "running", input: current.input, modelVersion: current.modelVersion, stats: current.stats }
      : { status: "running", input, modelVersion, stats: null });
    let worker: Worker | undefined;
    const timer = setTimeout(() => {
      try {
        worker = new Worker(new URL("./battleSimulation.worker.ts", import.meta.url), { type: "module" });
      } catch {
        setState({ status: "error", error: FAILED });
        return;
      }
      worker.onmessage = ({ data }: MessageEvent<BattleSimulationMessage>) => {
        if ("error" in data) {
          worker?.terminate();
          setState({ status: "error", error: data.error });
        } else if (data.done) {
          worker?.terminate();
          setState({ status: "done", input, modelVersion, stats: data.stats });
        } else {
          setState({ status: "running", input, modelVersion, stats: data.stats });
        }
      };
      worker.onerror = () => {
        worker?.terminate();
        setState({ status: "error", error: FAILED });
      };
      const request: BattleSimulationRequest = { input, modelVersion, runs: RUNS, minRuns: MIN_RUNS, budgetMs: BUDGET_MS, maxMs: MAX_MS };
      worker.postMessage(request);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [key]);
  return state;
}
