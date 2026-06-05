import { ArrowLeft, Copy, ExternalLink, RefreshCw, Swords } from "lucide-preact";
import { useState } from "preact/hooks";

import type { BattleReport } from "../walletFlow";

interface BattleReportPageProps {
  error?: string | undefined;
  loading: boolean;
  missionId: string | null;
  onBack: () => void;
  onRetry: () => void;
  report?: BattleReport | undefined;
  shareUrl: string;
}

export function BattleReportPage({
  error,
  loading,
  missionId,
  onBack,
  onRetry,
  report,
  shareUrl,
}: BattleReportPageProps) {
  const [copied, setCopied] = useState(false);

  const copyShareUrl = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(shareUrl)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      })
      .catch(() => setCopied(false));
  };

  return (
    <section className="grid gap-4">
      <header className="flex flex-col gap-3 border-b border-white/10 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300/80">
            Battle Report
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">
            {missionId ? `Mission #${missionId}` : "Shared combat result"}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
            Public combat outcome, losses, debris, and round snapshots from the contract event stream.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="inline-flex h-9 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-3 text-sm font-medium text-slate-200 transition hover:bg-white/10" onClick={onBack} type="button">
            <ArrowLeft aria-hidden="true" size={15} />
            Mission Control
          </button>
          <button className="inline-flex h-9 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-3 text-sm font-medium text-slate-200 transition hover:bg-white/10" onClick={onRetry} type="button">
            <RefreshCw aria-hidden="true" size={15} />
            Refresh
          </button>
          <button className="inline-flex h-9 items-center justify-center gap-2 rounded border border-cyan-300/30 bg-cyan-300/10 px-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-300/20" onClick={copyShareUrl} type="button">
            <Copy aria-hidden="true" size={15} />
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </header>

      {loading ? (
        <div className="rounded-lg border border-white/10 bg-[#101624] p-4 text-sm text-slate-400">
          Loading battle report...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-300/25 bg-red-400/10 p-4 text-sm text-red-100">
          {error}
        </div>
      ) : report ? (
        <>
          <div className="grid gap-3 lg:grid-cols-4">
            <Metric label="Outcome" value={outcomeLabel(report.outcome)} tone={outcomeTone(report.outcome)} />
            <Metric label="Rounds" value={report.rounds.toString()} />
            <Metric label="Loot" value={formatResources(report.loot)} />
            <Metric label="Debris" value={`${formatResource(report.debris.metal)} M / ${formatResource(report.debris.crystal)} C`} />
          </div>

          <section className="grid gap-3 lg:grid-cols-2">
            <Panel title="Combatants">
              <Datum label="Attacker" value={shortHash(report.attacker)} />
              <Datum label="Target planet" value={`#${report.targetPlanetId}`} />
              <Datum label="Resolver transaction" value={shortHash(report.transactionHash)} />
              <Datum label="Block" value={report.blockNumber} />
            </Panel>
            <Panel title="Total Losses">
              <Datum label="Attacker" value={formatResources(report.attackerLosses)} />
              <Datum label="Defender" value={formatResources(report.defenderLosses)} />
              <Datum label="Random seed" value={shortHash(report.randomSeed)} />
              <a className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-200 hover:text-cyan-100" href={shareUrl}>
                <ExternalLink aria-hidden="true" size={13} />
                Share URL
              </a>
            </Panel>
          </section>

          <section className="rounded-lg border border-white/10 bg-[#101624] p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded border border-white/10 bg-black/20 text-cyan-200">
                  <Swords aria-hidden="true" size={17} />
                </span>
                <h3 className="text-sm font-semibold text-white">Round Log</h3>
              </div>
              <span className="text-xs tabular-nums text-slate-400">{report.roundReports.length}</span>
            </div>
            {report.roundReports.length === 0 ? (
              <p className="text-sm text-slate-500">No round snapshots were emitted for this battle.</p>
            ) : (
              <div className="grid gap-2">
                {report.roundReports.map((round) => (
                  <article className="grid gap-2 rounded-md border border-white/10 bg-black/20 p-3 sm:grid-cols-[5rem_1fr_1fr]" key={round.round}>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Round</p>
                      <p className="mt-0.5 text-sm font-semibold text-white">{round.round}</p>
                    </div>
                    <Datum label="Attacker" value={`${formatResource(round.attackerUnits)} units / ${formatResources(round.attackerLosses)} lost`} />
                    <Datum label="Defender" value={`${formatResource(round.defenderUnits)} units / ${formatResources(round.defenderLosses)} lost`} />
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="rounded-lg border border-white/10 bg-[#101624] p-4 text-sm text-slate-400">
          Select a resolved attack from Mission Control to open its public battle report.
        </div>
      )}
    </section>
  );
}

function Panel({ children, title }: { children: preact.ComponentChildren; title: string }) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#101624] p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">{title}</h3>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function Metric({ label, tone = "neutral", value }: { label: string; tone?: "danger" | "neutral" | "success"; value: string }) {
  const valueClass = tone === "success" ? "text-emerald-200" : tone === "danger" ? "text-red-100" : "text-white";
  return (
    <div className="rounded-lg border border-white/10 bg-[#101624] p-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold ${valueClass}`}>{value}</dd>
    </div>
  );
}

function Datum({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-300">{value}</dd>
    </div>
  );
}

function outcomeLabel(outcome: BattleReport["outcome"]): string {
  if (outcome === "AttackerWin") return "Attacker victory";
  if (outcome === "DefenderWin") return "Defender victory";
  return "Draw";
}

function outcomeTone(outcome: BattleReport["outcome"]): "danger" | "neutral" | "success" {
  if (outcome === "AttackerWin") return "success";
  if (outcome === "DefenderWin") return "danger";
  return "neutral";
}

function formatResources(resources: { metal: string; crystal: string; deuterium?: string }): string {
  const deuterium = resources.deuterium ? ` / ${formatResource(resources.deuterium)} D` : "";
  return `${formatResource(resources.metal)} M / ${formatResource(resources.crystal)} C${deuterium}`;
}

function formatResource(value: string): string {
  return Number(value).toLocaleString();
}

function shortHash(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}
