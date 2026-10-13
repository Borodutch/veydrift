import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  activeCombatModel,
  battlePreviewInputKey,
  type BattleOutcome,
  type CombatResources,
  type CombatTechnology,
  type ContractBattleInput,
  type ContractBattleReportSeed,
  type ContractBattleResult,
} from "../battlePreview";

const REPORT_TIMEOUT_MS = 6_000;

type LazyBattleReportState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; report: ContractBattleResult }
  | { status: "error"; message: string };

/** The "i" control that opens one simulated battle: an eager report, or `input` replayed with `seed`
 * under `modelVersion` (default: the active model), which must be the model the odds were simulated with. */
export function SimulatedBattleReportControl({ report: eagerReport = null, input: reportInput, seed: reportSeed, modelVersion = activeCombatModel() }: {
  report?: ContractBattleResult | null | undefined;
  input?: ContractBattleInput | undefined;
  seed?: ContractBattleReportSeed | undefined;
  modelVersion?: number | undefined;
}) {
  if (eagerReport) {
    return (
      <SimulatedBattleReportDetails
        generateReport={() => undefined}
        report={eagerReport}
        sourceKey="eager-report"
        state={{ status: "ready", report: eagerReport }}
      />
    );
  }
  if (!reportInput || !reportSeed) {
    return (
      <button
        aria-label="Open simulated battle report"
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.04] text-[11px] font-semibold normal-case text-slate-300 transition hover:border-signal/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        disabled
        title="A report is available when required public combat intel is known"
        type="button"
      >
        i
      </button>
    );
  }

  const sourceKey = `${battlePreviewInputKey(reportInput)}:${modelVersion}:${reportSeed.sampleId}:${reportSeed.randomWord}:${reportSeed.fast ? "fast" : "exact"}`;
  return (
    <LazySimulatedBattleReportControl
      key={sourceKey}
      modelVersion={modelVersion}
      reportInput={reportInput}
      reportSeed={reportSeed}
      sourceKey={sourceKey}
    />
  );
}

function LazySimulatedBattleReportControl({
  modelVersion,
  reportInput,
  reportSeed,
  sourceKey,
}: {
  modelVersion: number;
  reportInput: ContractBattleInput;
  reportSeed: ContractBattleReportSeed;
  sourceKey: string;
}) {
  const [state, setState] = useState<LazyBattleReportState>({ status: "idle" });
  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const requestIdRef = useRef(0);
  const stopWorker = useCallback(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = undefined;
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  // sourceKey keys this component: no mount-time reset that can cancel a
  // report opened before passive effects finish.
  useEffect(() => () => {
    requestIdRef.current += 1;
    stopWorker();
  }, [sourceKey, stopWorker]);

  const generateReport = useCallback(() => {
    if (state.status === "loading" || state.status === "ready") return;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    stopWorker();
    setState({ status: "loading" });
    const fail = (message: string) => {
      if (requestIdRef.current !== requestId) return;
      stopWorker();
      setState({ status: "error", message });
    };
    try {
      const worker = new Worker(new URL("../battleReport.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<
        | { report: ContractBattleResult; requestId: number; modelVersion: number }
        | { error: string; requestId: number; modelVersion: number }
      >) => {
        if (event.data.requestId !== requestId || requestIdRef.current !== requestId) return;
        stopWorker();
        if (event.data.modelVersion !== modelVersion) {
          fail("This battle report is out of date. Please refresh.");
          return;
        }
        if ("report" in event.data) setState({ status: "ready", report: event.data.report });
        else setState({ status: "error", message: event.data.error });
      };
      worker.onerror = () => fail("The battle report failed. Please retry.");
      worker.onmessageerror = () => fail("The battle report could not be read.");
      timeoutRef.current = setTimeout(() => fail("The battle report took too long. Please retry."), REPORT_TIMEOUT_MS);
      worker.postMessage({
        fast: reportSeed.fast === true,
        input: reportInput,
        modelVersion,
        randomWord: reportSeed.randomWord,
        requestId,
        sampleId: reportSeed.sampleId,
      });
    } catch {
      fail("The battle report could not start. Please retry.");
    }
  }, [modelVersion, reportInput, reportSeed, state.status, stopWorker]);

  return (
    <SimulatedBattleReportDetails
      generateReport={generateReport}
      report={state.status === "ready" ? state.report : null}
      sourceKey={sourceKey}
      state={state}
    />
  );
}

function SimulatedBattleReportDetails({
  generateReport,
  report,
  sourceKey,
  state,
}: {
  generateReport: () => void;
  report: ContractBattleResult | null;
  sourceKey: string;
  state: LazyBattleReportState;
}) {
  return (
    <details
      className="group/report"
      key={sourceKey}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.currentTarget.open = false;
      }}
      onToggle={(event) => {
        if (event.currentTarget.open) generateReport();
      }}
    >
      <summary
        aria-label="Open simulated battle report"
        className="grid h-5 w-5 cursor-pointer list-none place-items-center rounded-full border border-white/15 bg-white/[0.04] text-[11px] font-semibold normal-case text-slate-300 transition hover:border-signal/50 hover:text-white [&::-webkit-details-marker]:hidden"
        role="button"
        title="Open simulated battle report"
      >
        i
      </summary>
      <div className="hidden group-open/report:block">
        <div
          aria-label="Simulated battle report"
          aria-modal="true"
          className="fixed inset-0 z-[100] overflow-y-auto bg-black/75 p-3 backdrop-blur-sm sm:p-6"
          role="dialog"
        >
          <div
            className="mx-auto grid max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl gap-4 overflow-y-auto rounded-lg border border-white/15 bg-[#0b101c] p-4 shadow-2xl shadow-black/60 sm:max-h-[calc(100dvh-3rem)] sm:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">Possible battle</h2>
                <p className="mt-1 text-xs text-slate-400">
                  One simulated battle. Real battles vary.
                </p>
              </div>
              <button
                aria-label="Close simulated battle report"
                className="inline-grid h-9 w-9 shrink-0 place-items-center rounded border border-white/15 text-slate-300 transition hover:border-white/30 hover:bg-white/[0.05] hover:text-white"
                onClick={(event) => {
                  const details = event.currentTarget.closest("details");
                  if (details) details.open = false;
                }}
                title="Close"
                type="button"
              >
                <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
                  <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
                </svg>
              </button>
            </div>

            {report ? (
              <>
                <div className="grid gap-1 rounded surface-inset p-3 text-xs">
                  <CompactFactRow label="Final outcome" value={battleOutcomeLabel(report.outcome)} />
                  <CompactFactRow label="Attacker losses" value={formatCompactResources(report.attackerLosses)} />
                  <CompactFactRow label="Defender ship losses" value={formatCompactResources(report.defenderLosses)} />
                  {report.defender.lostDefenses.length ? (
                    <>
                      <CompactFactRow label="Defenses destroyed" value={formatBattleComposition(report.defender.lostDefenses)} />
                      <CompactFactRow label="Repaired after battle" value={formatBattleComposition(report.defender.repairedDefenses)} />
                    </>
                  ) : null}
                  <CompactFactRow label="Debris field (ships only)" value={formatCompactResources({ ...report.debris, deuterium: 0 })} />
                  <CompactFactRow label="Moon chance" value={`${report.moonChancePercent}%`} />
                </div>

                <section className="grid gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Forces</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {report.attackers.map((participant) => (
                      <BattleParticipantCard key={participant.id} participant={participant} />
                    ))}
                    <BattleParticipantCard participant={report.defender} showDefenses />
                    {report.defender.counterplay.map((participant) => (
                      <BattleParticipantCard key={participant.id} participant={participant} />
                    ))}
                  </div>
                </section>

                <section className="grid gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Combat rounds</h3>
                  {report.rounds.length === 0 ? (
                    <p className="rounded surface-inset p-3 text-xs text-slate-400">
                      Combat ended before round 1 because one side had no battlefield units.
                    </p>
                  ) : report.rounds.map((round) => (
                    <article className="grid gap-2 rounded surface-inset p-3" key={round.round}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-white">Round {round.round}</h4>
                        <span className="text-xs tabular-nums text-slate-400">
                          {round.attackerStartingUnits.toLocaleString()} attackers / {round.defenderStartingUnits.toLocaleString()} defenders at start
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        Rapidfire extra shots: {round.attackerRapidfireExtraShots.toLocaleString()} attacker / {round.defenderRapidfireExtraShots.toLocaleString()} defender
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <RoundSideReport title="Attackers" participants={round.attackers} />
                        <RoundSideReport
                          defenses={round.defender}
                          participants={[round.defender, ...round.defender.counterplay]}
                          title="Defenders"
                        />
                      </div>
                    </article>
                  ))}
                </section>
              </>
            ) : state.status === "error" ? (
              <div className="grid gap-3 rounded border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">
                <p>{state.message}</p>
                <button
                  className="w-fit rounded border border-white/15 px-3 py-2 text-sm font-medium text-slate-100"
                  onClick={generateReport}
                  type="button"
                >
                  Retry
                </button>
              </div>
            ) : (
              <BattleReportSkeleton />
            )}
          </div>
        </div>
      </div>
    </details>
  );
}

function BattleParticipantCard({
  participant,
  showDefenses = false,
}: {
  participant: ContractBattleResult["attackers"][number] | ContractBattleResult["defender"];
  showDefenses?: boolean | undefined;
}) {
  const defenses = "startingDefenses" in participant ? participant.startingDefenses : [];
  return (
    <article className="rounded surface-inset p-2 text-xs">
      <p className="font-medium text-slate-200">{participant.label}</p>
      {participant.owner && participant.owner !== "Connected commander" ? (
        <p className="mt-0.5 break-all text-[11px] text-slate-500">{participant.owner}</p>
      ) : null}
      <p className="mt-1 text-slate-400">{formatTechLevels(participant.technology)}</p>
      <p className="mt-1 text-slate-300">
        <span className="font-medium text-slate-400">Fleet: </span>
        {formatBattleComposition(participant.startingShips)}
      </p>
      {showDefenses ? (
        <p className="mt-1 text-slate-300">
          <span className="font-medium text-slate-400">Defenses: </span>
          {formatBattleComposition(defenses)}
        </p>
      ) : null}
    </article>
  );
}

function BattleReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Generating simulated battle report" className="grid animate-pulse gap-4">
      <div className="grid gap-2 rounded surface-inset p-3">
        <span className="h-3 w-24 rounded bg-white/10" />
        <span className="h-3 w-full rounded bg-white/[0.07]" />
        <span className="h-3 w-2/3 rounded bg-white/[0.07]" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <span className="h-24 rounded surface-inset" />
        <span className="h-24 rounded surface-inset" />
      </div>
      <span className="h-36 rounded surface-inset" />
    </div>
  );
}

function RoundSideReport({
  defenses,
  participants,
  title,
}: {
  defenses?: ContractBattleResult["defender"] | undefined;
  participants: ContractBattleResult["attackers"];
  title: string;
}) {
  const shipLosses = participants.flatMap((participant) =>
    participant.lostShips.map((row) => ({ ...row, label: `${participant.label}: ${row.label}` })),
  );
  return (
    <div className="rounded surface-inset p-2 text-xs">
      <p className="font-medium text-slate-300">{title}</p>
      <p className="mt-1 text-slate-500">Losses</p>
      <p className="text-slate-300">
        {formatBattleComposition([
          ...shipLosses,
          ...(defenses?.lostDefenses.map((row) => ({ ...row, label: `Defense: ${row.label}` })) ?? []),
        ])}
      </p>
      <p className="mt-1 text-slate-500">Survivors</p>
      <p className="text-slate-300">
        {formatBattleComposition([
          ...participants.flatMap((participant) =>
            participant.survivingShips.map((row) => ({ ...row, label: `${participant.label}: ${row.label}` })),
          ),
          ...(defenses?.survivingDefenses.map((row) => ({ ...row, label: `Defense: ${row.label}` })) ?? []),
        ])}
      </p>
    </div>
  );
}

function formatBattleComposition(rows: Array<{ label: string; count: number }>): string {
  return rows.length > 0
    ? rows.map((row) => `${row.count.toLocaleString()} ${row.label}`).join(", ")
    : "None";
}

export function battleOutcomeLabel(outcome: BattleOutcome): string {
  return outcome === "win" ? "Attacker win" : outcome === "defeat" ? "Defender win" : "Draw";
}

export function CompactFactRow({ label, value }: { label: string; value: ComponentChildren }) {
  return (
    <div className="grid min-w-0 gap-0.5 text-[11px] min-[360px]:grid-cols-[8rem_minmax(0,1fr)] min-[360px]:items-baseline min-[360px]:gap-2">
      <span className="text-slate-500">{label}</span>
      <div className="break-words text-right tabular-nums text-slate-200">{value}</div>
    </div>
  );
}

export function formatCompactResources(resources: CombatResources | null): string {
  if (!resources) return "Unknown";
  const amount = (value: number) => Math.max(0, Math.trunc(value)).toLocaleString();
  return `${amount(resources.metal)} M / ${amount(resources.crystal)} C / ${amount(resources.deuterium)} D`;
}

function formatTechLevels(levels: CombatTechnology): string {
  return `W${levels.weapons} S${levels.shielding} A${levels.armor}`;
}
