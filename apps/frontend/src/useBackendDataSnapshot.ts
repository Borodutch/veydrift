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
      return store.subscribe(emit);
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

export function useBackendDataSnapshots<T>(
  store: BackendDataStore | undefined,
  keys: readonly string[],
): ReadonlyMap<string, GameStateEntry<T> | undefined> {
  const [, setVersion] = useState(0);
  const signature = keys.join("\u0000");
  useEffect(() => {
    if (!store || keys.length === 0) return;
    return store.subscribe(() => setVersion((version) => version + 1));
  }, [signature, store]);
  return new Map(keys.map((key) => [key, store?.snapshot<T>(key)]));
}
