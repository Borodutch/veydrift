import { describe, expect, test } from "bun:test";
import {
  ACTION_NOTICE_AUTO_DISMISS_MS,
  isTransientRequestActionLabel,
  isUserRejectedActionLabel,
  scheduleActionNoticeAutoDismiss,
} from "./actionNoticeAutoDismiss";

type ActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string; autoDismiss?: boolean };

type VisibleActionState = Exclude<ActionState, { status: "idle" }>;
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

  test("auto-dismisses transient request progress notices after the configured delay", () => {
    const timers = createFakeTimers();
    const requestAction: ActionState = { status: "pending", label: "Alliance join request: awaiting wallet" };
    const requestHarness = createActionHarness(requestAction);

    scheduleActionNoticeAutoDismiss({
      action: requestAction,
      clearTimeoutFn: timers.clearTimeoutFn,
      setAction: requestHarness.setAction,
      setTimeoutFn: timers.setTimeoutFn,
    });

    expect(isTransientRequestActionLabel(requestAction.label)).toBe(true);
    timers.advanceBy(ACTION_NOTICE_AUTO_DISMISS_MS);

    expect(requestHarness.state).toEqual({ status: "idle" });
  });

  test("auto-dismisses submitted and syncing request notices without dismissing blockers", () => {
    const timers = createFakeTimers();
    const submittedAction: ActionState = { status: "pending", label: "Metal withdrawal request: submitted 0x1234abcd..." };
    const syncingAction: ActionState = { status: "pending", label: "Alliance join request: syncing indexed state..." };
    const blockerAction: ActionState = { status: "error", label: "Wallet is locked." };
    const submittedHarness = createActionHarness(submittedAction);
    const syncingHarness = createActionHarness(syncingAction);
    const blockerHarness = createActionHarness(blockerAction);

    for (const [action, harness] of [
      [submittedAction, submittedHarness],
      [syncingAction, syncingHarness],
      [blockerAction, blockerHarness],
    ] as const) {
      scheduleActionNoticeAutoDismiss({
        action,
        clearTimeoutFn: timers.clearTimeoutFn,
        setAction: harness.setAction,
        setTimeoutFn: timers.setTimeoutFn,
      });
    }

    expect(isTransientRequestActionLabel(submittedAction.label)).toBe(true);
    expect(isTransientRequestActionLabel(syncingAction.label)).toBe(true);
    expect(isTransientRequestActionLabel(blockerAction.label)).toBe(false);
    expect(timers.pendingCount()).toBe(2);

    timers.advanceBy(ACTION_NOTICE_AUTO_DISMISS_MS);

    expect(submittedHarness.state).toEqual({ status: "idle" });
    expect(syncingHarness.state).toEqual({ status: "idle" });
    expect(blockerHarness.state).toBe(blockerAction);
  });

  test("auto-dismisses real overview infrastructure and research progress labels", () => {
    const timers = createFakeTimers();
    const transientActions: VisibleActionState[] = [
      { status: "pending", label: "Refreshing infrastructure state" },
      { status: "pending", label: "Building upgrade: unlock your wallet if needed, then confirm in your wallet." },
      {
        status: "pending",
        label: "Building completion: confirm the game-state update in your wallet; token balance changes are not expected.",
      },
      {
        status: "pending",
        label: "Building completion submitted. Waiting for backend state to clear this completed queue before another finish attempt.",
      },
      {
        status: "error",
        label: "Building completion failed for this ready queue. Refreshing backend state before another finish attempt.",
      },
      { status: "pending", label: "Refreshing research queue..." },
      {
        status: "pending",
        label: "Small Cargo build confirmed. Rechecking game state after a temporary API/RPC outage.",
      },
    ];
    const harnesses = transientActions.map(createActionHarness);

    for (const [index, action] of transientActions.entries()) {
      scheduleActionNoticeAutoDismiss({
        action,
        clearTimeoutFn: timers.clearTimeoutFn,
        setAction: harnesses[index]!.setAction,
        setTimeoutFn: timers.setTimeoutFn,
      });

      expect(isTransientRequestActionLabel(action.label)).toBe(true);
    }

    expect(timers.pendingCount()).toBe(transientActions.length);

    timers.advanceBy(ACTION_NOTICE_AUTO_DISMISS_MS);

    expect(harnesses.map((harness) => harness.state)).toEqual(transientActions.map(() => ({ status: "idle" })));
  });

  test("keeps actionable infrastructure and wallet blockers visible", () => {
    const timers = createFakeTimers();
    const blockerActions: VisibleActionState[] = [
      { status: "error", label: "Wallet is locked." },
      {
        status: "error",
        label: "Infrastructure API is temporarily unavailable. The app will keep retrying, and building actions are paused until current backend state is available.",
      },
      {
        status: "error",
        label: "Can't verify the current building queue right now. Refresh infrastructure state and retry before finishing.",
      },
      { status: "error", label: "Game contract rejected this fleet action: INVALID_MISSION_SPEED." },
      { status: "error", label: "Mission launch was rejected by mission preflight. Refresh fleet, cargo, fuel, and target state before retrying." },
    ];
    const harnesses = blockerActions.map(createActionHarness);

    for (const [index, action] of blockerActions.entries()) {
      scheduleActionNoticeAutoDismiss({
        action,
        clearTimeoutFn: timers.clearTimeoutFn,
        setAction: harnesses[index]!.setAction,
        setTimeoutFn: timers.setTimeoutFn,
      });

      expect(isTransientRequestActionLabel(action.label)).toBe(false);
    }

    expect(timers.pendingCount()).toBe(0);

    timers.advanceBy(ACTION_NOTICE_AUTO_DISMISS_MS);

    expect(harnesses.map((harness) => harness.state)).toEqual(blockerActions);
  });
});
