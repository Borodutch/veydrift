import { useMemo } from "preact/hooks";
import { useSyncExternalStore } from "preact/compat";
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
  const projection = useMemo(
    () => store && key ? backendDataProjection<T>(store, key) : undefined,
    [key, store],
  );
  return useSyncExternalStore(projection?.subscribe ?? noSubscription, projection?.getSnapshot ?? noSnapshot);
}

const noSubscription = () => () => {};
const noSnapshot = () => undefined;

export function backendDataSnapshotsProjection<T>(store: BackendDataStore | undefined, keys: readonly string[]) {
  let snapshot: ReadonlyMap<string, GameStateEntry<T> | undefined> | undefined;
  const getSnapshot = () => {
    if (!snapshot || keys.some(key => snapshot!.get(key) !== store?.snapshot<T>(key))) {
      snapshot = new Map(keys.map(key => [key, store?.snapshot<T>(key)]));
    }
    return snapshot;
  };
  return {
    getSnapshot,
    subscribe: (listener: () => void) => {
      const unsubscribes = keys.map(key => store?.subscribeKey(key, listener));
      return () => unsubscribes.forEach(unsubscribe => unsubscribe?.());
    },
  };
}

export function useBackendDataSnapshots<T>(
  store: BackendDataStore | undefined,
  keys: readonly string[],
): ReadonlyMap<string, GameStateEntry<T> | undefined> {
  const signature = keys.join("\u0000");
  const projection = useMemo(() => backendDataSnapshotsProjection<T>(store, [...keys]), [store, signature]);
  // The platform hook rechecks after subscribing, including writes between render
  // and effect, without changing identity for unrelated parent renders.
  return useSyncExternalStore(projection.subscribe, projection.getSnapshot);
}
