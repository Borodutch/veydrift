import { useCallback, useLayoutEffect, useRef } from "preact/hooks";
import type { BackendDataStore } from "./backendDataStore";
import type { GameStateEntry } from "./gameStateStore";
import { useBackendDataSnapshot } from "./useBackendDataSnapshot";

export type BackendDataQuery<T> = {
  refetch: () => Promise<T | undefined>;
  snapshot: GameStateEntry<T> | undefined;
};

/**
 * The standard UI boundary for backend state. Components declare a canonical
 * key and loader; this hook owns subscription, cache-aware initial load and
 * loading/error snapshots. Components never keep a second response cache.
 */
export function useBackendDataQuery<T>(
  store: BackendDataStore | undefined,
  key: string | undefined,
  load: (() => Promise<T>) | undefined,
  enabled = true,
): BackendDataQuery<T> {
  const loadRef = useRef(load);
  loadRef.current = load;
  const snapshot = useBackendDataSnapshot<T>(store, key);

  const refetch = useCallback(async (): Promise<T | undefined> => {
    if (!enabled || !store || !key || !loadRef.current) return undefined;
    try {
      return await loadRef.current();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return undefined;
      throw error;
    }
  }, [enabled, key, store]);

  // Start the key-specific canonical read for every committed route before a
  // subsequent navigation can replace it in the same microtask turn. The
  // transport remains asynchronous; this only registers the resource with
  // the store. That lets the store preserve independent keys (and discard a
  // late response from an old view) without reintroducing page cancellation.
  useLayoutEffect(() => {
    if (enabled && store && key && store.isFresh(key)) return;
    void refetch().catch(() => {
      // The data store owns the canonical failure state exposed by `snapshot`.
      // Avoid an unhandled rejection when a background query fails. Consumers
      // render the snapshot's error state, so background failures must not be
      // promoted to a window error.
    });
    // Canonical reads are cache-owned. Unmounting one surface must not abort a
    // transport that another subscriber (or the next route) can reuse.
    return undefined;
  }, [refetch, store]);

  return { refetch, snapshot };
}
