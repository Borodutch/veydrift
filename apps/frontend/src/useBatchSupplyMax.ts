import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { SupplyMaxRequest, SupplyMaxResponse } from "./batchSupplyMax.worker";

/** One worker per click: termination cancels the exact, potentially long search. */
export function useBatchSupplyMax(options: SupplyMaxRequest["options"], draftKey: string, disabled: boolean, onMaximum: (resource: SupplyMaxRequest["resource"], maximum: number) => void) {
  const active = useRef<Worker | null>(null);
  const [busy, setBusy] = useState<SupplyMaxRequest["resource"] | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState("");

  const stop = () => {
    const worker = active.current;
    active.current = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
  };
  const cancel = () => {
    if (active.current) setNotice("Max cancelled.");
    stop(); setBusy(null); setError(undefined);
  };

  // Snapshot refreshes recreate objects even when planner inputs are unchanged.
  // Compare values (including Set membership), not the options object identity.
  const optionsKey = JSON.stringify(options, (_key, value) => value instanceof Set ? [...value].sort() : value);

  // Layout cleanup invalidates results at commit, before a queued worker event
  // can overwrite edited resources, routes, inventory, eligibility or overrides.
  useLayoutEffect(() => {
    if (busy) setNotice("Max cancelled: inputs changed.");
    setBusy(null);
    setError(undefined);
    return stop;
  }, [optionsKey, draftKey, disabled]);

  const start = (resource: SupplyMaxRequest["resource"]) => {
    cancel();
    if (disabled) return;
    setBusy(resource);
    setNotice(`Calculating ${resource} Max…`);
    try {
      const worker = new Worker(new URL("./batchSupplyMax.worker.ts", import.meta.url), { type: "module" });
      active.current = worker;
      const fail = () => {
        if (active.current !== worker) return;
        stop();
        setBusy(null);
        setNotice("");
        setError("Could not calculate Max. Please retry or enter an amount.");
      };
      worker.onmessage = ({ data }: MessageEvent<SupplyMaxResponse>) => {
        if (active.current !== worker) return;
        if (!("maximum" in data) || !Number.isSafeInteger(data.maximum) || data.maximum < 0) { fail(); return; }
        stop();
        setBusy(null);
        setNotice(`${resource[0]!.toUpperCase()}${resource.slice(1)} Max applied.`);
        onMaximum(resource, data.maximum);
      };
      worker.onerror = fail;
      worker.onmessageerror = fail;
      worker.postMessage({ options, resource } satisfies SupplyMaxRequest);
    } catch {
      stop();
      setBusy(null);
      setNotice("");
      setError("Could not calculate Max. Please retry or enter an amount.");
    }
  };

  return { busy, error, notice, start, cancel };
}
