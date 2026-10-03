import { useEffect, useState } from "preact/hooks";
import { CONTRACT_COMBAT_MODEL_VERSION } from "./battlePreview";
import { apiBaseUrlForRuntimeConfig, playableApiUrl } from "./runtimeConfig";
import { fetchGameApiJson } from "./walletFlow";

export function combatModelMatches(value: unknown): boolean {
  return typeof value === "object" && value !== null
    && (value as { version?: unknown }).version === CONTRACT_COMBAT_MODEL_VERSION;
}

// No persisted capability cache: old contracts, absent getters and failed reads fail closed.
export function useVerifiedCombatModel(): boolean {
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let expiry: ReturnType<typeof setTimeout>;
    let timeout: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    let expiresAt: number | undefined;
    const invalidate = () => {
      clearTimeout(expiry);
      expiresAt = undefined;
      if (active) setVerified(false);
    };
    const check = async () => {
      if (!active) return;
      if (expiresAt !== undefined && performance.now() >= expiresAt) invalidate();
      const request = new AbortController();
      controller = request;
      const deadline = Math.min(performance.now() + 5_000, expiresAt ?? Infinity);
      // A pending refresh is not a failed verification. Keep open reports mounted,
      // but expire the previous success independently, even if transport ignores abort.
      timeout = setTimeout(() => {
        request.abort();
        invalidate();
      }, 5_000);
      try {
        const runtime = await fetchGameApiJson<{ apiUrl: string }>(playableApiUrl + "/runtime-config", "Combat model configuration", { cache: "no-store", signal: request.signal });
        if (!active || request.signal.aborted) return;
        if (performance.now() >= deadline) { invalidate(); return; }
        const api = apiBaseUrlForRuntimeConfig(runtime);
        const value = await fetchGameApiJson<unknown>(api + "/combat-model", "Combat model", { cache: "no-store", signal: request.signal });
        if (!active || request.signal.aborted) return;
        if (performance.now() >= deadline || !combatModelMatches(value)) {
          invalidate();
          return;
        }
        clearTimeout(expiry);
        setVerified(true);
        expiresAt = performance.now() + 20_000;
        expiry = setTimeout(() => {
          controller?.abort();
          invalidate();
        }, 20_000);
      } catch { invalidate(); }
      finally {
        clearTimeout(timeout);
        if (active) timer = setTimeout(check, 15_000);
      }
    };
    void check();
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(expiry);
      clearTimeout(timeout);
      controller?.abort();
    };
  }, []);
  return verified;
}
