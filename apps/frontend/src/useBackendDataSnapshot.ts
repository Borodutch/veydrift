import { useEffect, useMemo, useState } from "preact/hooks";
import type { BackendDataStore } from "./backendDataStore";
import type { GameStateEntry } from "./gameStateStore";

export type BackendDataProjection<T> = {
  getSnapshot: () => GameStateEntry<T> | undefined;
  subscribe: (listener: (snapshot: GameStateEntry<T> | undefined) => void) => () => void;
};

export function backendDataProjection<T>(
  store: BackendDataStore,
  key: string,
): BackendDataProjection<T> {
  const getSnapshot = () => store.snapshot<T>(key);
  return {
    getSnapshot,
    subscribe: (listener) => {
      const emit = () => listener(getSnapshot());
      emit();
      return store.subscribeKey(key, emit);
    },
  };
}

export function useBackendDataSnapshot<T>(
  store: BackendDataStore | undefined,
  key: string | undefined,
): GameStateEntry<T> | undefined {
  const [, setVersion] = useState(0);
  const projection = useMemo(
    () => store && key ? backendDataProjection<T>(store, key) : undefined,
    [key, store],
  );
  useEffect(() => {
    if (!projection) return;
    return projection.subscribe(() => setVersion((version) => version + 1));
  }, [projection]);
  return projection?.getSnapshot();
}

/**
 * A selected resource has not failed merely because its new cache key has no
 * entry yet. This is normal while a planet switch schedules the first read.
 */
export function isBackendDataSnapshotLoading<T>(
  snapshot: GameStateEntry<T> | undefined,
  enabled: boolean,
): boolean {
  if (!enabled) return false;
  return (
    snapshot === undefined ||
    snapshot.freshness === "refreshing" ||
    (snapshot.data === undefined && snapshot.freshness === "delayed")
  );
}

export function useBackendDataSnapshots<T>(
  store: BackendDataStore | undefined,
  keys: readonly string[],
): ReadonlyMap<string, GameStateEntry<T> | undefined> {
  const [, setVersion] = useState(0);
  const signature = keys.join("\u0000");
  const stableKeys = useMemo(() => [...keys], [signature]);
  useEffect(() => {
    if (!store || stableKeys.length === 0) return;
    const refresh = () => setVersion((version) => version + 1);
    const unsubscribes = stableKeys.map((key) => store.subscribeKey(key, refresh));
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [stableKeys, store]);
  return new Map(stableKeys.map((key) => [key, store?.snapshot<T>(key)]));
}
