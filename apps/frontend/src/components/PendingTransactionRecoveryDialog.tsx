import { useLayoutEffect, useRef } from "preact/hooks";
import type { PendingTransactionRecoveryDecision } from "../backendDataStore";
import { pendingTransactionRecoveryAgeLabel } from "../pendingTransactionRecovery";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

type IsolatedElementState = {
  ariaHidden: string | null;
  element: HTMLElement;
  inert: boolean;
};

function dialogFocusTargets(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => (
    element.getAttribute("aria-hidden") !== "true"
    && element.getClientRects().length > 0
  ));
}

function isolateDialogBackground(backdrop: HTMLElement): () => void {
  const isolated: IsolatedElementState[] = [];
  let path: HTMLElement | null = backdrop;

  while (path?.parentElement && path !== document.body) {
    const parent: HTMLElement = path.parentElement;
    for (const sibling of parent.children) {
      if (!(sibling instanceof HTMLElement) || sibling === path) continue;
      isolated.push({
        ariaHidden: sibling.getAttribute("aria-hidden"),
        element: sibling,
        inert: sibling.inert,
      });
      sibling.inert = true;
      sibling.setAttribute("aria-hidden", "true");
    }
    path = parent;
  }

  return () => {
    for (const { ariaHidden, element, inert } of isolated) {
      element.inert = inert;
      if (ariaHidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", ariaHidden);
    }
  };
}

export function PendingTransactionRecoveryDialog({
  decision,
  onDiscard,
  onKeepWaiting,
}: {
  decision: PendingTransactionRecoveryDecision;
  onDiscard: () => void;
  onKeepWaiting: () => void;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const checkingStatus = useRef<HTMLParagraphElement>(null);
  const checking = decision.phase === "checking";

  useLayoutEffect(() => {
    const backdropElement = backdrop.current;
    const dialogElement = dialog.current;
    if (!backdropElement || !dialogElement) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restoreBackground = isolateDialogBackground(backdropElement);
    const focusFallback = () => {
      const preferred = checkingStatus.current ?? keepButton.current ?? dialogElement;
      preferred.focus();
    };
    const containFocus = (event: FocusEvent) => {
      if (!(event.target instanceof Node) || dialogElement.contains(event.target)) return;
      focusFallback();
    };
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const targets = dialogFocusTargets(dialogElement);
      if (targets.length === 0) {
        event.preventDefault();
        focusFallback();
        return;
      }

      const first = targets[0]!;
      const last = targets[targets.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogElement.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogElement.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("focusin", containFocus, true);
    document.addEventListener("keydown", trapTab, true);
    return () => {
      document.removeEventListener("focusin", containFocus, true);
      document.removeEventListener("keydown", trapTab, true);
      restoreBackground();
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [decision.transactionHash]);

  useLayoutEffect(() => {
    const target = checking ? checkingStatus.current : keepButton.current;
    target?.focus();
  }, [checking, decision.transactionHash]);

  return (
    <div className="pending-transaction-recovery-backdrop" data-pending-transaction-recovery ref={backdrop}>
      <section
        aria-describedby="pending-transaction-recovery-description"
        aria-labelledby="pending-transaction-recovery-title"
        aria-modal="true"
        className="pending-transaction-recovery-dialog"
        ref={dialog}
        role="alertdialog"
        tabIndex={-1}
      >
        <span aria-hidden="true" className="pending-transaction-recovery-kicker">Base transaction recovery</span>
        <h2 id="pending-transaction-recovery-title">Saved transaction needs attention</h2>
        <p id="pending-transaction-recovery-description">
          Veydrift has waited {pendingTransactionRecoveryAgeLabel(decision.submittedAt)} for saved transaction
          {" "}<code>{decision.transactionHash.slice(0, 10)}…</code>. It may still confirm later, so every new
          transaction remains blocked until you choose what to do.
        </p>
        {decision.error ? <p className="pending-transaction-recovery-error" role="status">{decision.error}</p> : null}
        {checking ? (
          <p
            aria-live="polite"
            className="pending-transaction-recovery-checking"
            ref={checkingStatus}
            role="status"
            tabIndex={0}
          >
            Checking the latest saved transaction status. New transactions remain blocked.
          </p>
        ) : null}
        <div className="pending-transaction-recovery-actions">
          <button
            className="pending-transaction-recovery-keep"
            disabled={checking}
            onClick={onKeepWaiting}
            ref={keepButton}
            type="button"
          >
            Keep waiting
          </button>
          <button
            className="pending-transaction-recovery-discard"
            disabled={checking}
            onClick={onDiscard}
            type="button"
          >
            {checking ? "Checking latest status…" : "Discard saved record"}
          </button>
        </div>
        <p className="pending-transaction-recovery-footnote">
          Discard rechecks Veydrift first and never sends a transaction. If discarded, only a later retry can ask
          your wallet for one new transaction on Base Mainnet.
        </p>
      </section>
    </div>
  );
}
