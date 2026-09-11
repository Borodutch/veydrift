import { useCallback, useMemo, useRef, useState } from "preact/hooks";
import type { BackendDataStore } from "./backendDataStore";
import type { ActionStateSetter, AutoDismissableActionState } from "./actionNoticeAutoDismiss";
import type { WriteTransactionState } from "./transactionActionGate";
import { useBackendDataSnapshot } from "./useBackendDataSnapshot";

export function transactionActionNotice(state: WriteTransactionState | undefined): AutoDismissableActionState {
  if (!state || state.phase === "idle") return { status: "idle" };
  const status = state.phase === "success" ? "success" : state.phase === "error" ? "error" : "pending";
  return { status, label: state.label ?? (status === "pending" ? "Processing…" : status === "success" ? "Completed." : "Action failed.") };
}

/** Transaction progress is a store projection. Only validation feedback and
 * dismissal are local; a new transaction update supersedes that presentation. */
export function useTransactionAction<T extends AutoDismissableActionState>(
  store: BackendDataStore | undefined, wallet: string | undefined, group: string, planetId?: string,
): [T, ActionStateSetter<T>] {
  const key = store?.writeTransactionKey(`group:${group}`, wallet, planetId);
  const snapshot = useBackendDataSnapshot<WriteTransactionState>(store, key);
  const transaction = snapshot?.data;
  const [local, setLocal] = useState<{ key: string | undefined; transaction: WriteTransactionState | undefined; value: T }>();
  const value = useMemo(() => (local && local.key === key && local.transaction === transaction
    ? local.value
    : { ...(local && local.key === key ? local.value : {}), ...transactionActionNotice(transaction) }) as T, [key, local, transaction]);
  const current = useRef({ key, transaction, value });
  current.current = { key, transaction, value };
  const setAction = useCallback<ActionStateSetter<T>>(update => {
    const { key, transaction, value } = current.current;
    const next = typeof update === "function" ? update(value) : update;
    if (next === value) return;
    setLocal({ key, transaction, value: next });
  }, []);
  return [value, setAction];
}
