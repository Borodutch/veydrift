import { useEffect, useState } from "preact/hooks";
import { fetchGameApiJson } from "./walletFlow";

export function moonSupplyBatchMatches(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { version?: unknown }).version === 1;
}

// Presentation only. The wallet independently reads the exact contract's getter
// on its configured simulation chain before every atomic moon batch.
export function useVerifiedMoonSupplyBatch(apiBase: string | undefined, enabled: boolean): boolean {
  const [verifiedApi, setVerifiedApi] = useState<string>();
  useEffect(() => {
    setVerifiedApi(undefined);
    if (!enabled || !apiBase) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let expiry: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const check = async () => {
      controller = new AbortController();
      const request = controller;
      const deadline = performance.now() + 5_000;
      const timeout = setTimeout(() => { request.abort(); if (active) setVerifiedApi(undefined); }, 5_000);
      try {
        const value = await fetchGameApiJson<unknown>(apiBase + "/moon-supply-batch", "Moon Supply", { cache: "no-store", signal: request.signal });
        if (!active || request.signal.aborted) return;
        if (performance.now() >= deadline) { setVerifiedApi(undefined); return; }
        clearTimeout(expiry);
        setVerifiedApi(moonSupplyBatchMatches(value) ? apiBase : undefined);
        expiry = setTimeout(() => { if (active) setVerifiedApi(undefined); }, 20_000);
      } catch { if (active) setVerifiedApi(undefined); }
      finally { clearTimeout(timeout); if (active) timer = setTimeout(check, 15_000); }
    };
    void check();
    return () => { active = false; controller?.abort(); clearTimeout(timer); clearTimeout(expiry); };
  }, [apiBase, enabled]);
  return enabled && apiBase !== undefined && verifiedApi === apiBase;
}
