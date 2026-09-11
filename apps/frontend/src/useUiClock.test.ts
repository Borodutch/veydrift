import { expect, test } from "bun:test";
import { subscribeUiClock } from "./useUiClock";

test("display subscribers share one timer, pause hidden, catch up on resume, and clean up", () => {
  const originals = ["document", "setInterval", "clearInterval"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  let visibility: (() => void) | undefined;
  const document = {
    visibilityState: "visible",
    addEventListener: (_name: string, listener: () => void) => { visibility = listener; },
    removeEventListener: () => { visibility = undefined; },
  };
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "setInterval", { configurable: true, value: (tick: () => void) => { timers.set(++nextTimer, tick); return nextTimer; } });
  Object.defineProperty(globalThis, "clearInterval", { configurable: true, value: (id: number) => timers.delete(id) });
  const unsubscribes: Array<() => void> = [];
  let updates = 0;
  try {
    for (let index = 0; index < 10; index++) unsubscribes.push(subscribeUiClock(() => updates++));
    expect(timers.size).toBe(1);
    const before = updates;
    [...timers.values()][0]!();
    expect(updates - before).toBe(10);
    document.visibilityState = "hidden";
    visibility!();
    expect(timers.size).toBe(0);
    const hidden = updates;
    document.visibilityState = "visible";
    visibility!();
    expect(updates - hidden).toBe(10);
    expect(timers.size).toBe(1);
    unsubscribes.splice(0).forEach(unsubscribe => unsubscribe());
    expect(timers.size).toBe(0);
    expect(visibility).toBeUndefined();
  } finally {
    unsubscribes.forEach(unsubscribe => unsubscribe());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
