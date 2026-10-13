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

// Small battles finish all runs quickly; large ones stop after the time budget once minRuns are
// done, and huge ones (where minRuns alone would take minutes) after maxMs regardless.
/** The calculator: the referee's exact draws, about 5-10x the cost of a fast run (~5 ms on a desktop
 * for 100 ships vs 2,000 defenses), so a longer budget still gets several hundred runs. Large battles,
 * especially on phones, can stop at maxMs below minRuns; the results then say so (timeLimited). */
export const EXACT_SIMULATION: BattleSimulationLimits = { runs: 1_000, minRuns: 300, budgetMs: 5_000, maxMs: 15_000, fast: false };
/** Mission forecasts: several can run at once on a phone, for rosters that may still change before
 * the battle, so they keep the fast stream (same rules; ticket #105 measured averages within ~1-3%). */
export const FAST_SIMULATION: BattleSimulationLimits = { runs: 1_000, minRuns: 100, budgetMs: 4_000, maxMs: 8_000, fast: true };
const DEBOUNCE_MS = 250;
const FAILED = "The battle simulation failed. Please retry.";

export function useBattleSimulation(input: ContractBattleInput | null, modelVersion: number, limits: BattleSimulationLimits): BattleSimulation {
  const key = input ? JSON.stringify([modelVersion, limits, input]) : null;
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
      const request: BattleSimulationRequest = { ...limits, input, modelVersion };
      worker.postMessage(request);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [key]);
  return state;
}
