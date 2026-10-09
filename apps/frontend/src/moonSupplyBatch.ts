import { useEffect, useState } from "preact/hooks";
import { fetchGameApiJson } from "./walletFlow";

export function moonSupplyBatchMatches(value: unknown, gameContractAddress: string | undefined, chainId: number | undefined): boolean {
  if (!gameContractAddress || !/^0x[0-9a-f]{40}$/i.test(gameContractAddress) || !Number.isSafeInteger(chainId) || !chainId || typeof value !== "object" || value === null) return false;
  const proof = value as {version?: unknown; gameContractAddress?: unknown; chainId?: unknown};
  return proof.version === 1 && proof.chainId === chainId
    && typeof proof.gameContractAddress === "string"
    && proof.gameContractAddress.toLowerCase() === gameContractAddress.toLowerCase();
}

// Presentation only. The wallet independently reads the exact contract's getter
// on its configured simulation chain before every atomic moon batch.
export function useVerifiedMoonSupplyBatch(apiBase: string | undefined, enabled: boolean, gameContractAddress: string | undefined, chainId: number | undefined): boolean {
  const identity = JSON.stringify([apiBase, gameContractAddress?.toLowerCase(), chainId]);
  const [verifiedApi, setVerifiedApi] = useState<string>();
  useEffect(() => {
    setVerifiedApi(undefined);
    if (!enabled || !apiBase || !gameContractAddress || !chainId) return;
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
        setVerifiedApi(moonSupplyBatchMatches(value, gameContractAddress, chainId) ? identity : undefined);
        expiry = setTimeout(() => { if (active) setVerifiedApi(undefined); }, 20_000);
      } catch { if (active) setVerifiedApi(undefined); }
      finally { clearTimeout(timeout); if (active) timer = setTimeout(check, 15_000); }
    };
    void check();
    return () => { active = false; controller?.abort(); clearTimeout(timer); clearTimeout(expiry); };
  }, [apiBase, enabled, gameContractAddress, chainId, identity]);
  return enabled && apiBase !== undefined && verifiedApi === identity;
}
