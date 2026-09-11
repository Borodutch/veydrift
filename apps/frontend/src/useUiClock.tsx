import type { ComponentChildren } from "preact";
import { useSyncExternalStore } from "preact/compat";

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function tick() {
  now = Date.now();
  for (const listener of listeners) listener();
}

function resume() {
  clearInterval(timer);
  timer = undefined;
  if (document.visibilityState === "hidden") return;
  tick();
  timer = setInterval(tick, 1_000);
}

/** Presentation only. One visible-tab clock; it never fetches or changes game state. */
export function subscribeUiClock(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", resume);
    resume();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", resume);
    }
  };
}

const snapshot = () => now;
const noSubscription = () => () => {};

export function useUiClock(enabled = true): number {
  return useSyncExternalStore(enabled ? subscribeUiClock : noSubscription, snapshot);
}

export function UiClock({ children }: { children: (now: number) => ComponentChildren }) {
  return <>{children(useUiClock())}</>;
}
