import { useRef, useState } from "preact/hooks";
import { productionDraftAfterReceipt, type ProductionOrder } from "./productionBuildPlan";
import type { WriteTransactionOutcome, WriteTransactionState } from "./transactionActionGate";

export function useProductionBuildPlan() {
  const [drafts, setDrafts] = useState<Record<string, ProductionOrder[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [unknown, setUnknown] = useState<Record<string, boolean>>({});
  const busyRef = useRef(new Set<string>());
  const clearedSnapshots = useRef(new WeakSet<readonly ProductionOrder[]>());
  const setError = (key: string, message: string) => setErrors(previous => ({ ...previous, [key]: message }));
  const release = (key: string) => {
    busyRef.current.delete(key);
    setBusy(previous => ({ ...previous, [key]: false }));
  };
  const start = (key: string) => {
    if (busyRef.current.has(key)) return false;
    busyRef.current.add(key);
    setBusy(previous => ({ ...previous, [key]: true }));
    setError(key, "");
    return true;
  };
  const onState = (key: string, submitted: readonly ProductionOrder[], state: WriteTransactionState) => {
    if (state.phase === "confirmed" || state.phase === "applied" || state.phase === "success") {
      if (!clearedSnapshots.current.has(submitted)) {
        clearedSnapshots.current.add(submitted);
        setDrafts(previous => ({ ...previous, [key]: productionDraftAfterReceipt(previous[key] ?? [], submitted, state.phase) }));
      }
      setUnknown(previous => ({ ...previous, [key]: false }));
      setError(key, "");
      if (state.phase !== "confirmed") release(key);
    } else if (state.phase === "unknown") {
      release(key);
      setUnknown(previous => ({ ...previous, [key]: true }));
      setError(key, state.label ?? "Check your wallet activity before retrying; the build may have been sent.");
    } else if (state.phase === "error") {
      release(key);
      setUnknown(previous => ({ ...previous, [key]: false }));
      setError(key, state.label ?? "Build plan failed.");
    }
  };
  const onOutcome = (key: string, submitted: readonly ProductionOrder[], outcome: WriteTransactionOutcome) => {
    if (outcome.outcome === "unknown" && !clearedSnapshots.current.has(submitted)) {
      release(key);
      setUnknown(previous => ({ ...previous, [key]: true }));
    } else if (outcome.outcome === "not-submitted" || outcome.outcome === "reverted") {
      release(key);
      setError(key, outcome.error instanceof Error ? outcome.error.message : "Build plan was not submitted. Check wallet activity if an earlier request was uncertain.");
    }
  };
  return { drafts, setDrafts, errors, busy, unknown, busyRef, setError, start, release, onState, onOutcome };
}
