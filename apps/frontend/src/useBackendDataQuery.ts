import { useCallback, useLayoutEffect, useRef } from "preact/hooks";
import type { BackendDataQueryDescriptor } from "./backendDataStore";
import type { GameStateEntry } from "./gameStateStore";
import { useBackendDataSnapshot } from "./useBackendDataSnapshot";

export type BackendDataQuery<T> = {
  refetch: () => Promise<T | undefined>;
  snapshot: GameStateEntry<T> | undefined;
};

/**
 * The standard UI boundary for backend state. The data module supplies a
 * typed descriptor with the canonical key and loader; components only choose
 * whether that resource is currently needed and render its shared snapshot.
 */
export function useBackendDataQuery<T>(
  query: BackendDataQueryDescriptor<T> | undefined,
  enabled = true,
): BackendDataQuery<T> {
  const queryRef = useRef(query);
  queryRef.current = query;
  const store = query?.store;
  const key = query?.key;
  const snapshot = useBackendDataSnapshot<T>(store, key);

  const refetch = useCallback(async (): Promise<T | undefined> => {
    const current = queryRef.current;
    if (!enabled || !current) return undefined;
    try {
      return await current.read();
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
    if (!enabled || !store || !key || store.isFresh(key)) return;
    void refetch().catch(() => {
      // The data store owns the canonical failure state exposed by `snapshot`.
      // Avoid an unhandled rejection when a background query fails. Consumers
      // render the snapshot's error state, so background failures must not be
      // promoted to a window error.
    });
    // Canonical reads are cache-owned. Preserve an already-started transport
    // for another subscriber (or the next route), but remove queued work that
    // has never touched the network when this route is replaced.
    return () => {
      // `useBackendDataSnapshot` releases its subscription from a passive
      // effect. Let that cleanup run first, then cancel only if this was the
      // final consumer of a request that has not started transport yet.
      // Otherwise a route transition can cancel a shared descriptor while an
      // already-mounted screen is still waiting on it.
      setTimeout(() => store.cancelQueuedReadIfUnobserved(key), 0);
    };
  }, [key, refetch, store]);

  return { refetch, snapshot };
}
