import { ArrowLeft, Copy, ExternalLink, Swords } from "lucide-preact";
import { useState } from "preact/hooks";

import type { BattleReport } from "../walletFlow";
import { PageHeader, RefreshButton } from "./PageHeader";

interface BattleReportsPageProps {
  error?: string | undefined;
  loading: boolean;
  onBack: () => void;
  onOpenBattleReport: (missionId: string) => void;
  onRetry: () => void;
  reports: BattleReport[];
  shareUrl: string;
}

export function BattleReportsPage({
  error,
  loading,
  onBack,
  onOpenBattleReport,
  onRetry,
  reports,
  shareUrl,
}: BattleReportsPageProps) {
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
      <PageHeader
        actions={(
          <>
          <button className="inline-flex h-9 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-3 text-sm font-medium text-slate-200 transition hover:bg-white/10" onClick={onBack} type="button">
            <ArrowLeft aria-hidden="true" size={15} />
            Mission Control
          </button>
          <RefreshButton loading={loading} onRefresh={onRetry} title="Refresh battle reports" />
          <button className="inline-flex h-9 items-center justify-center gap-2 rounded border border-cyan-300/30 bg-cyan-300/10 px-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-300/20" onClick={copyShareUrl} type="button">
            <Copy aria-hidden="true" size={15} />
            {copied ? "Copied" : "Copy list link"}
          </button>
          </>
        )}
        title="Public Combat Archive"
      />

      {loading ? (
        <div className="rounded-lg border border-white/10 bg-[#101624] p-4 text-sm text-slate-400">
          Loading battle reports...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-300/25 bg-red-400/10 p-4 text-sm text-red-100">
          {error}
        </div>
      ) : reports.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-[#101624] p-4 text-sm text-slate-400">
          No resolved attack reports are available yet.
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {reports.map((report) => (
            <article className="min-w-0 rounded-lg border border-white/10 bg-[#101624] p-4" key={report.missionId}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded border border-white/10 bg-black/20 text-cyan-200">
                      <Swords aria-hidden="true" size={17} />
                    </span>
                    <h3 className="truncate text-sm font-semibold text-white">
                      Mission #{report.missionId} / {battleOutcomeLabel(report.outcome)}
                    </h3>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Attacker {shortHash(report.attacker)} {"->"} Planet #{report.targetPlanetId}
                  </p>
                </div>
                <button
                  className="inline-flex items-center gap-1.5 rounded border border-cyan-300/35 bg-cyan-300/10 px-2 py-1 text-xs font-medium text-cyan-100 transition hover:bg-cyan-300/20"
                  onClick={() => onOpenBattleReport(report.missionId)}
                  type="button"
                >
                  <ExternalLink aria-hidden="true" size={13} />
                  Open report
                </button>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <Datum label="Rounds" value={report.rounds.toString()} />
                <Datum label="Loot" value={formatResources(report.loot)} />
                <Datum label="Attacker losses" value={formatResources(report.attackerLosses)} />
                <Datum label="Defender losses" value={formatResources(report.defenderLosses)} />
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
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

function battleOutcomeLabel(outcome: BattleReport["outcome"]): string {
  if (outcome === "AttackerWin") return "Attacker win";
  if (outcome === "DefenderWin") return "Defender win";
  return "Draw";
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
