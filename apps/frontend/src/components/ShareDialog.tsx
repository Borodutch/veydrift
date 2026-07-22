import { Check, Copy, Link2, Share2, X } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { shareReportUrl } from "../shareReport";
import { shareTargets } from "../shareTargets";

// In-app share dialog for a battle-report link (VEY-KANEO-339).
//
// The battle-report Share button used to copy the link silently (and, on desktop Chrome, fall back
// from the native Web Share sheet to a silent clipboard write) — QA repeatedly read that as "no share
// dialog appears" and even as a navigation bug. This dialog is a real DOM overlay that always shows
// when the button is clicked: it presents the shareable URL, a copy-link action with inline feedback,
// social share targets (X / Telegram / Farcaster), and — only where the browser supports it (mobile /
// Farcaster webview) — an optional native share sheet. It is a modal, so it cannot navigate the
// viewer away from the report; dismissing it (X, backdrop, or Escape) simply closes it.

export type ShareDialogCopyState = "copied" | "error" | "idle";

function copyToClipboard(url: string): Promise<ShareDialogCopyState> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return Promise.resolve("error");
  }
  return navigator.clipboard
    .writeText(url)
    .then<ShareDialogCopyState>(() => "copied")
    .catch<ShareDialogCopyState>(() => "error");
}

export function ShareDialog({
  onClose,
  title = "Share battle report",
  url,
}: {
  onClose: () => void;
  title?: string | undefined;
  url: string;
}) {
  const [copyState, setCopyState] = useState<ShareDialogCopyState>("idle");
  const urlInputRef = useRef<HTMLInputElement>(null);
  const targets = shareTargets(url);
  // The native share sheet is only offered where the platform actually has one (mobile browsers and
  // the Farcaster webview); on desktop it would silently fall back to a clipboard copy, so it is
  // hidden there and the explicit Copy link / social targets carry the dialog instead.
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  // Close on Escape so the dialog behaves like the app's other modals (keyboard-dismissable).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Reset the copied/error pill whenever a different report is shared.
  useEffect(() => {
    setCopyState("idle");
  }, [url]);

  // Auto-clear the copied/error feedback so the button settles back to its resting label.
  useEffect(() => {
    if (copyState === "idle" || typeof window === "undefined") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 2_000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const handleCopy = () => {
    urlInputRef.current?.select();
    void copyToClipboard(url).then(setCopyState);
  };

  const handleNativeShare = () => {
    void shareReportUrl(typeof navigator === "undefined" ? undefined : navigator, url);
  };

  const copyLabel = copyState === "copied" ? "Copied!" : copyState === "error" ? "Copy failed" : "Copy link";

  return (
    <div
      aria-labelledby="share-dialog-title"
      aria-modal="true"
      className="modal-backdrop-enter fixed inset-0 z-50 grid place-items-center bg-black/70 p-3"
      onClick={onClose}
      role="dialog"
    >
      {/* Stop clicks inside the panel from bubbling to the backdrop's close handler. */}
      <div
        className="modal-panel-enter w-full max-w-md overflow-hidden rounded-lg border border-white/10 bg-[#0f1624] shadow-2xl shadow-black/40"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded border border-white/10 bg-black/20 text-cyan-200">
              <Share2 aria-hidden="true" size={16} />
            </span>
            <h3 id="share-dialog-title" className="break-words text-base font-semibold text-white">
              {title}
            </h3>
          </div>
          <button
            aria-label="Close share dialog"
            className="inline-flex h-10 w-10 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={16} strokeWidth={2.2} />
          </button>
        </div>

        <div className="grid gap-4 p-4">
          <p className="text-sm text-slate-400">
            Anyone with this link can open the battle report — no wallet required.
          </p>

          <div className="flex items-stretch gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded border border-white/10 bg-black/30 px-2.5">
              <Link2 aria-hidden="true" className="shrink-0 text-slate-500" size={15} />
              <input
                aria-label="Shareable battle report link"
                className="min-w-0 flex-1 bg-transparent py-2 text-sm text-slate-200 outline-none"
                onFocus={(event) => event.currentTarget.select()}
                readOnly
                ref={urlInputRef}
                value={url}
              />
            </div>
            <button
              aria-label={copyLabel}
              className={`inline-flex h-auto shrink-0 items-center justify-center gap-1.5 rounded border px-3 text-sm font-medium transition ${
                copyState === "copied"
                  ? "border-emerald-300/40 bg-emerald-300/15 text-emerald-100"
                  : copyState === "error"
                    ? "border-red-300/40 bg-red-400/15 text-red-100"
                    : "border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
              }`}
              onClick={handleCopy}
              type="button"
            >
              {copyState === "copied" ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}
              {copyLabel}
            </button>
          </div>

          <div className="grid gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Share to</p>
            <div className="flex flex-wrap gap-2">
              {targets.map((target) => (
                <a
                  className="inline-flex h-9 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-3 text-sm font-medium text-slate-200 transition hover:bg-white/10"
                  href={target.href}
                  key={target.key}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {target.label}
                </a>
              ))}
              {canNativeShare ? (
                <button
                  className="inline-flex h-9 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-3 text-sm font-medium text-slate-200 transition hover:bg-white/10"
                  onClick={handleNativeShare}
                  type="button"
                >
                  <Share2 aria-hidden="true" size={15} />
                  More…
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
