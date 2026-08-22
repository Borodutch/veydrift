import { useCallback, useEffect, useRef } from "preact/hooks";
import type { BackendDataStore } from "./backendDataStore";
import type { GameStateEntry } from "./gameStateStore";
import { useBackendDataSnapshot } from "./useBackendDataSnapshot";

let nextQueryScope = 0;

export type BackendDataQuery<T> = {
  refetch: () => Promise<T | undefined>;
  snapshot: GameStateEntry<T> | undefined;
};

/**
 * The standard UI boundary for backend state. Components declare a canonical
 * key and loader; this hook owns subscription, initial load, cancellation and
 * loading/error snapshots. Components never keep a second response cache.
 */
export function useBackendDataQuery<T>(
  store: BackendDataStore | undefined,
  key: string | undefined,
  load: ((scope: string) => Promise<T>) | undefined,
  enabled = true,
): BackendDataQuery<T> {
  const scope = useRef(`backend-query:${nextQueryScope++}`).current;
  const loadRef = useRef(load);
  loadRef.current = load;
  const snapshot = useBackendDataSnapshot<T>(store, key);

  const refetch = useCallback(async (): Promise<T | undefined> => {
    if (!enabled || !store || !key || !loadRef.current) return undefined;
    try {
      return await loadRef.current(scope);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return undefined;
      throw error;
    }
  }, [enabled, key, scope, store]);

  useEffect(() => {
    void refetch().catch(() => {
      // The data store owns the canonical failure state exposed by `snapshot`.
      // Avoid an unhandled rejection when a background query fails. Consumers
      // render the snapshot's error state, so background failures must not be
      // promoted to a window error.
    });
    return () => store?.cancelScope(scope);
  }, [refetch, scope, store]);

  return { refetch, snapshot };
}
