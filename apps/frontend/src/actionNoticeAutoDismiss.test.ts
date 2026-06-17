import { describe, expect, test } from "bun:test";
import {
  ACTION_NOTICE_AUTO_DISMISS_MS,
  isUserRejectedActionLabel,
  scheduleActionNoticeAutoDismiss,
} from "./actionNoticeAutoDismiss";

type ActionState =
  | { status: "idle" }
  | { status: "success"; label: string }
  | { status: "error"; label: string; autoDismiss?: boolean };

type TimerHandle = ReturnType<typeof window.setTimeout>;

function createFakeTimers() {
  let now = 0;
  let nextHandle = 1;
  const timers = new Map<number, { callback: () => void; dueAt: number }>();

  return {
    advanceBy(ms: number) {
      now += ms;
      for (const [handle, timer] of Array.from(timers.entries())) {
        if (timer.dueAt <= now) {
          timers.delete(handle);
          timer.callback();
        }
      }
    },
    clearTimeoutFn(handle: TimerHandle) {
      timers.delete(Number(handle));
    },
    pendingCount() {
      return timers.size;
    },
    setTimeoutFn(callback: () => void, delay: number): TimerHandle {
      const handle = nextHandle++;
      timers.set(handle, { callback, dueAt: now + delay });
      return handle as unknown as TimerHandle;
    },
  };
}

function createActionHarness(initial: ActionState) {
  let state = initial;

  return {
    get state() {
      return state;
    },
    setAction(value: ActionState | ((current: ActionState) => ActionState)) {
      state = typeof value === "function" ? value(state) : value;
    },
  };
}

describe("action notice auto-dismiss timers", () => {
  test("auto-dismisses success notices after the configured fake timer delay", () => {
    const timers = createFakeTimers();
    const action: ActionState = { status: "success", label: "Building upgrade started." };
    const harness = createActionHarness(action);

    scheduleActionNoticeAutoDismiss({
      action,
      clearTimeoutFn: timers.clearTimeoutFn,
      setAction: harness.setAction,
      setTimeoutFn: timers.setTimeoutFn,
    });

    timers.advanceBy(ACTION_NOTICE_AUTO_DISMISS_MS - 1);
    expect(harness.state).toBe(action);

    timers.advanceBy(1);
    expect(harness.state).toEqual({ status: "idle" });
  });

  test("does not let a late fake timer clear a newer action notice", () => {
    const timers = createFakeTimers();
    const oldAction: ActionState = { status: "success", label: "Building upgrade started." };
    const newerAction: ActionState = { status: "error", label: "Wallet is locked." };
    const harness = createActionHarness(oldAction);

    scheduleActionNoticeAutoDismiss({
      action: oldAction,
      clearTimeoutFn: timers.clearTimeoutFn,
      setAction: harness.setAction,
      setTimeoutFn: timers.setTimeoutFn,
    });

    harness.setAction(newerAction);
    timers.advanceBy(ACTION_NOTICE_AUTO_DISMISS_MS);

    expect(harness.state).toBe(newerAction);
  });

  test("auto-dismisses user-rejected transaction notices but keeps contract blockers", () => {
    const timers = createFakeTimers();
    const rejectedAction: ActionState = { status: "error", label: "Building upgrade failed: User rejected the request." };
    const contractAction: ActionState = { status: "error", label: "Game contract rejected this fleet action: INVALID_MISSION_SPEED." };
    const rejectedHarness = createActionHarness(rejectedAction);
    const contractHarness = createActionHarness(contractAction);

    scheduleActionNoticeAutoDismiss({
      action: rejectedAction,
      clearTimeoutFn: timers.clearTimeoutFn,
      setAction: rejectedHarness.setAction,
      setTimeoutFn: timers.setTimeoutFn,
    });
    scheduleActionNoticeAutoDismiss({
      action: contractAction,
      clearTimeoutFn: timers.clearTimeoutFn,
      setAction: contractHarness.setAction,
      setTimeoutFn: timers.setTimeoutFn,
    });

    expect(isUserRejectedActionLabel(rejectedAction.label)).toBe(true);
    expect(isUserRejectedActionLabel(contractAction.label)).toBe(false);
    expect(timers.pendingCount()).toBe(1);

    timers.advanceBy(ACTION_NOTICE_AUTO_DISMISS_MS);

    expect(rejectedHarness.state).toEqual({ status: "idle" });
    expect(contractHarness.state).toBe(contractAction);
  });
});
