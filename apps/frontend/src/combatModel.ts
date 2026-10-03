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
    let controller: AbortController | undefined;
    const check = async () => {
      if (!active) return;
      setVerified(false);
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 5_000);
      try {
        const runtime = await fetchGameApiJson<{ apiUrl: string }>(playableApiUrl + "/runtime-config", "Combat model configuration", { cache: "no-store", signal: controller.signal });
        const api = apiBaseUrlForRuntimeConfig(runtime);
        const value = await fetchGameApiJson<unknown>(api + "/combat-model", "Combat model", { cache: "no-store", signal: controller.signal });
        if (active) setVerified(combatModelMatches(value));
      } catch { if (active) setVerified(false); }
      finally {
        clearTimeout(timeout);
        if (active) timer = setTimeout(check, 15_000);
      }
    };
    void check();
    return () => { active = false; clearTimeout(timer); controller?.abort(); };
  }, []);
  return verified;
}
