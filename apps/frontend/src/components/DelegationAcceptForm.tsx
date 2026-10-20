import { useState } from "preact/hooks";

import { shortAddress } from "../walletFlow";

/**
 * Accepts a main wallet's delegate proposal with acceptDelegate(main): one button per known
 * proposer (from the delegation read's `proposedBy`) plus a main-wallet address entry.
 */
export function DelegationAcceptForm({
  busy,
  onAccept,
  proposedBy = [],
}: {
  busy: boolean;
  onAccept: (main: string) => void;
  proposedBy?: readonly string[] | undefined;
}) {
  const [mainDraft, setMainDraft] = useState("");
  return (
    <div className="grid gap-2">
      {proposedBy.map((main) => (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-cyan-300/30 bg-cyan-300/[0.06] px-3 py-2" key={main}>
          <p className="text-[11px] leading-4 text-cyan-100">
            <span className="font-mono">{shortAddress(main)}</span> wants this wallet as its delegate.
          </p>
          <button
            aria-label={`Accept delegation from ${main}`}
            className="h-8 rounded border border-cyan-300/40 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => onAccept(main)}
            type="button"
          >
            Accept
          </button>
        </div>
      ))}
      <label className="grid gap-1 text-xs font-medium text-slate-200">
        Main wallet address
        <input
          className="h-9 rounded border border-white/10 bg-[#050b14]/95 px-3 font-mono text-xs text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:text-slate-500"
          disabled={busy}
          onInput={(event) => setMainDraft(event.currentTarget.value)}
          placeholder="0x…"
          value={mainDraft}
        />
      </label>
      <p className="text-[11px] leading-4 text-slate-300">
        Accept only a proposal from a main wallet you trust. Once accepted, every game action from this wallet plays for that main wallet instead of this one until either wallet revokes.
      </p>
      <button
        className="h-8 justify-self-end rounded border border-cyan-300/40 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy || !mainDraft.trim()}
        onClick={() => onAccept(mainDraft)}
        type="button"
      >
        Accept delegation
      </button>
    </div>
  );
}
