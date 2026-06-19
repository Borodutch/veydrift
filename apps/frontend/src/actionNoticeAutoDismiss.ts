export const ACTION_NOTICE_AUTO_DISMISS_MS = 10_000;

export type AutoDismissableActionState =
  | { status: "idle" }
  | { status: "pending" | "success" | "error"; label: string; autoDismiss?: boolean | undefined };

export type ActionStateSetter<State extends AutoDismissableActionState> = (
  value: State | ((current: State) => State)
) => void;

type TimeoutHandle = ReturnType<typeof window.setTimeout>;

const transientRequestActionLabelPatterns = [
  /awaiting wallet/i,
  /waiting for wallet signature/i,
  /submitted 0x[a-f0-9]+/i,
  /syncing indexed state/i,
  /refreshing (?:alliance (?:application|invitation)|fleet inventory|target protection|infrastructure state|research queue)/i,
  /confirm (?:the game-state update )?in your wallet/i,
  /unlock your wallet if needed, then confirm in your wallet/i,
  /waiting for backend state to clear this completed queue/i,
  /refreshing backend state before another finish attempt/i,
  /rechecking game state after a temporary API\/RPC outage/i,
] as const;

export function isUserRejectedActionLabel(label: string): boolean {
  if (/game contract rejected|contract rejected|mission preflight/i.test(label)) {
    return false;
  }

  return /user rejected|request rejected|transaction rejected|was rejected|denied|cancel(?:ed|led)/i.test(label);
}

export function isTransientRequestActionLabel(label: string): boolean {
  return transientRequestActionLabelPatterns.some((pattern) => pattern.test(label));
}

export function shouldAutoDismissActionNotice(action: AutoDismissableActionState): boolean {
  if (action.status === "success") return true;
  if (action.status === "pending") return isTransientRequestActionLabel(action.label);
  if (action.status !== "error") return false;
  return action.autoDismiss === true || isUserRejectedActionLabel(action.label) || isTransientRequestActionLabel(action.label);
}

export function scheduleActionNoticeAutoDismiss<State extends AutoDismissableActionState>({
  action,
  clearTimeoutFn = window.clearTimeout,
  setAction,
  setTimeoutFn = window.setTimeout,
  timeoutMs = ACTION_NOTICE_AUTO_DISMISS_MS,
}: {
  action: State;
  clearTimeoutFn?: (handle: TimeoutHandle) => void;
  setAction: ActionStateSetter<State>;
  setTimeoutFn?: (callback: () => void, delay: number) => TimeoutHandle;
  timeoutMs?: number;
}): (() => void) | undefined {
  if (!shouldAutoDismissActionNotice(action)) return undefined;

  const actionToDismiss = action;
  const timer = setTimeoutFn(() => {
    setAction((current) => (current === actionToDismiss ? ({ status: "idle" } as State) : current));
  }, timeoutMs);

  return () => clearTimeoutFn(timer);
}
