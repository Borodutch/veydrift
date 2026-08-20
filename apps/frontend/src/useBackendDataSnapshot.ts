import { useEffect, useState } from "preact/hooks";
import type { BackendDataStore } from "./backendDataStore";
import type { GameStateEntry } from "./gameStateStore";

export function useBackendDataSnapshot<T>(
  store: BackendDataStore | undefined,
  key: string | undefined,
): GameStateEntry<T> | undefined {
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!store) return;
    return store.subscribe(() => setVersion((version) => version + 1));
  }, [store]);
  return store && key ? store.snapshot<T>(key) : undefined;
}
