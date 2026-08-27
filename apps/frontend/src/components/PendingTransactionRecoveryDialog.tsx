import { useEffect, useRef } from "preact/hooks";
import type { PendingTransactionRecoveryDecision } from "../backendDataStore";
import { pendingTransactionRecoveryAgeLabel } from "../pendingTransactionRecovery";

export function PendingTransactionRecoveryDialog({
  decision,
  onDiscard,
  onKeepWaiting,
}: {
  decision: PendingTransactionRecoveryDecision;
  onDiscard: () => void;
  onKeepWaiting: () => void;
}) {
  const keepButton = useRef<HTMLButtonElement>(null);
  const checking = decision.phase === "checking";

  useEffect(() => {
    if (!checking) keepButton.current?.focus();
  }, [checking, decision.transactionHash]);

  return (
    <div className="pending-transaction-recovery-backdrop" data-pending-transaction-recovery>
      <section
        aria-describedby="pending-transaction-recovery-description"
        aria-labelledby="pending-transaction-recovery-title"
        aria-modal="true"
        className="pending-transaction-recovery-dialog"
        role="alertdialog"
      >
        <span aria-hidden="true" className="pending-transaction-recovery-kicker">Base transaction recovery</span>
        <h2 id="pending-transaction-recovery-title">Saved transaction needs attention</h2>
        <p id="pending-transaction-recovery-description">
          Veydrift has waited {pendingTransactionRecoveryAgeLabel(decision.submittedAt)} for saved transaction
          {" "}<code>{decision.transactionHash.slice(0, 10)}…</code>. It may still confirm later, so every new
          transaction remains blocked until you choose what to do.
        </p>
        {decision.error ? <p className="pending-transaction-recovery-error" role="status">{decision.error}</p> : null}
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
