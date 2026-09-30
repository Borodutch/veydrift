import { defenseCatalog } from "../playableMvp";
import { pendingDefenseSettlement } from "../defenseSettlement";
import type { QueueStateResponse } from "../walletFlow";

export function DefenseSettlementNotice({ queue, onFinish, disabled = false, transactionUnavailableReason }: {
  queue: QueueStateResponse | null | undefined;
  onFinish?: (() => void) | undefined;
  disabled?: boolean | undefined;
  transactionUnavailableReason?: string | undefined;
}) {
  const pending = pendingDefenseSettlement(queue);
  if (pending.size === 0) return null;
  return <section className="rounded border border-emerald-300/20 bg-emerald-300/5 p-3 text-sm text-emerald-100" aria-label="Defense settlement">
    <h3 className="font-semibold">Built · awaiting settlement</h3>
    <ul>{Array.from(pending, ([id, quantity]) => <li key={id}>
      {defenseCatalog.find(item => item.id === id)?.label ?? "Defense"}: {quantity.toLocaleString("en-US")}
    </li>)}</ul>
    <p className="mt-1 text-xs text-slate-300">Already paid for and finished building. These units are not included in Deployed until settled on-chain. No need to buy them again.</p>
    {onFinish && <>
      <button type="button" className="mt-3 rounded border border-emerald-300/40 px-3 py-2 disabled:opacity-50"
        disabled={disabled || Boolean(transactionUnavailableReason)}
        onClick={disabled || transactionUnavailableReason ? undefined : onFinish}>Finish defenses</button>
      <p className="mt-1 text-xs text-slate-300">{transactionUnavailableReason ?? "Confirm in your wallet to add these units to Deployed. A network fee applies."}</p>
    </>}
  </section>;
}
