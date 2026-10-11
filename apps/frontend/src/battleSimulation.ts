import { useEffect, useState } from "preact/hooks";
import type { BattleStats, ContractBattleInput } from "./battlePreview";

export type BattleSimulationRequest = {
  input: ContractBattleInput;
  modelVersion: number;
  runs: number;
  minRuns: number;
  budgetMs: number;
};
export type BattleSimulationMessage = { stats: BattleStats; done: boolean } | { error: string };

/** Stats always belong to `input`; while a new input runs, the previous result stays visible. */
export type BattleSimulation =
  | { status: "idle" }
  | { status: "running"; input: ContractBattleInput; stats: BattleStats | null }
  | { status: "done"; input: ContractBattleInput; stats: BattleStats }
  | { status: "error"; error: string };

// Small battles finish all runs instantly; large ones stop after the time budget (never below MIN_RUNS).
const RUNS = 1_000;
const MIN_RUNS = 100;
const BUDGET_MS = 4_000;
const DEBOUNCE_MS = 250;

export function useBattleSimulation(input: ContractBattleInput | null, modelVersion: number): BattleSimulation {
  const key = input ? JSON.stringify([modelVersion, input]) : null;
  const [state, setState] = useState<BattleSimulation>({ status: "idle" });
  useEffect(() => {
    if (!input) {
      setState({ status: "idle" });
      return undefined;
    }
    setState((current) => current.status === "running" || current.status === "done"
      ? { status: "running", input: current.input, stats: current.stats }
      : { status: "running", input, stats: null });
    let worker: Worker | undefined;
    const timer = setTimeout(() => {
      worker = new Worker(new URL("./battleSimulation.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }: MessageEvent<BattleSimulationMessage>) => {
        if ("error" in data) {
          worker?.terminate();
          setState({ status: "error", error: data.error });
        } else if (data.done) {
          worker?.terminate();
          setState({ status: "done", input, stats: data.stats });
        } else {
          setState({ status: "running", input, stats: data.stats });
        }
      };
      worker.onerror = () => {
        worker?.terminate();
        setState({ status: "error", error: "The battle simulation failed. Please retry." });
      };
      const request: BattleSimulationRequest = { input, modelVersion, runs: RUNS, minRuns: MIN_RUNS, budgetMs: BUDGET_MS };
      worker.postMessage(request);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [key]);
  return state;
}
