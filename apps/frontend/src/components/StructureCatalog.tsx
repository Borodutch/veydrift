import type { ComponentChildren } from "preact";
import { ArrowDown, Bomb, PackagePlus } from "lucide-preact";
import { useState } from "preact/hooks";
import type { ConstructionProgress } from "../constructionProgress";
import { formatDurationUntil } from "../durationFormat";
import { queueProgress, type QueueTimeline } from "../playableMvp";
import { AnimatedProgressBar } from "./AnimatedProgressBar";
import {
  InspectCatalogTile,
  InspectDetailHero,
  InspectDetailImage,
  InspectDetailShell,
  InspectTwoColumnLayout,
  SingleItemQueueProgress,
  useInspectDetailSelection,
} from "./InspectProgressLayout";
import { LevelInfoButton, LevelInfoModal, type LevelInfoColumn, type LevelInfoRow } from "./LevelInfoModal";

export type StructureCatalogItem<Key extends string> = {
  asset: string;
  currentText: string;
  /** A demolition running on this structure: rose wording, live countdown and progress. */
  demolition?: StructureDemolitionProgress | undefined;
  isDimmed: boolean;
  key: Key;
  label: string;
  labelTone?: "normal" | "muted" | undefined;
  statusText?: string | undefined;
  statusTone?: "accent" | "warning" | "danger" | undefined;
};

export type StructureDemolitionProgress = {
  indeterminate: boolean;
  label: string;
  progress: number;
  remaining: string;
};

/** A demolition running on the selected structure. */
export type StructureDemolition = StructureDemolitionProgress & {
  cancelDisabled?: boolean | undefined;
  onCancel?: (() => void) | undefined;
};

/**
 * Demolition timing from the same shared construction projection that drives
 * the active queue panel, so the card, detail and queue never disagree.
 */
export function structureDemolitionProgress(
  label: string,
  progressState: ConstructionProgress | undefined,
  timeline: QueueTimeline | undefined,
  now: number,
): StructureDemolitionProgress {
  return {
    indeterminate: progressState?.indeterminate ?? timeline?.startedAt === undefined,
    label,
    progress: progressState?.progress ?? queueProgress(timeline, now),
    remaining: progressState?.remaining ?? (timeline ? formatDurationUntil(timeline.readyAt, now) : "syncing"),
  };
}

export function StructureCatalog<Key extends string>({
  detail,
  items,
  onSelect,
  selectedKey,
}: {
  detail: ComponentChildren | ((selectItem: (key: Key) => void) => ComponentChildren);
  items: readonly StructureCatalogItem<Key>[];
  onSelect: (key: Key) => void;
  selectedKey: Key | undefined;
}) {
  const { detailPanelRef, selectInspectItem } = useInspectDetailSelection<Key>(onSelect);
  const renderedDetail = typeof detail === "function" ? detail(selectInspectItem) : detail;
  return (
    <InspectTwoColumnLayout
      catalog={items.map((item) => (
        <InspectCatalogTile
          asset={item.asset}
          currentText={item.currentText}
          demolition={item.demolition}
          isDimmed={item.isDimmed}
          isSelected={item.key === selectedKey}
          key={item.key}
          label={item.label}
          labelTone={item.labelTone}
          onClick={() => selectInspectItem(item.key)}
          statusText={item.statusText}
          statusTone={item.statusTone}
        />
      ))}
      detail={renderedDetail}
      detailPanelRef={detailPanelRef}
    />
  );
}

export type StructureLevelInfo = {
  columns: readonly LevelInfoColumn[];
  costLabel?: string | undefined;
  currentLevel: number;
  rows: readonly LevelInfoRow[];
};

export type StructureQueue = {
  completion?: {
    disabled: boolean;
    label: string;
    onClick: () => void;
    title?: string | undefined;
  } | undefined;
  isPrimaryItem: boolean;
  label: string;
  now: number;
  queue: QueueTimeline;
  title: { active: string; context: string };
};

export function StructureDetail({
  action,
  active,
  activeLabel = "Active",
  asset,
  cacheKey,
  demolishAction,
  demolition,
  description,
  effectContent,
  inactiveLabel = "Not built",
  infoContent,
  isDimmed,
  label,
  levelInfo,
  notice,
  queue,
  secondaryAction,
  statusReason,
  summary,
}: {
  action?: { ariaLabel: string; disabled: boolean; label: string; onClick: () => void } | undefined;
  active: boolean;
  activeLabel?: string | undefined;
  asset: string;
  cacheKey: string;
  /** Secondary destructive action; pass it only while demolition is actually available. */
  demolishAction?: { onClick: () => void } | undefined;
  /** Shown instead of the Demolish action while this structure is coming down. */
  demolition?: StructureDemolition | undefined;
  description: string;
  effectContent?: ComponentChildren | undefined;
  inactiveLabel?: string | undefined;
  infoContent: ComponentChildren;
  isDimmed: boolean;
  label: string;
  levelInfo?: StructureLevelInfo | undefined;
  notice?: { label: string; tone: "error" | "success" } | undefined;
  queue?: StructureQueue | undefined;
  secondaryAction?: { ariaLabel: string; onClick: () => void } | undefined;
  statusReason?: { disabled: boolean; label: string; supportingLabel?: string | undefined } | undefined;
  summary: string;
}) {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  // A running demolition replaces the Upgrade + Demolish row with its own status
  // row, so no second action looks available while the structure comes down.
  const inlineAction = demolition ? undefined : action;
  const inlineDemolishAction = demolition ? undefined : demolishAction;
  return (
    <InspectDetailShell>
      <InspectDetailHero
        image={<InspectDetailImage asset={asset} cacheKey={cacheKey} isDimmed={isDimmed} />}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="break-words text-lg font-semibold text-white">{label}</h3>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-sm text-slate-400">
              <span>{summary}</span>
              {levelInfo ? <LevelInfoButton itemLabel={label} onClick={() => setIsInfoOpen(true)} /> : null}
            </div>
          </div>
          <span className={`rounded px-2 py-1 text-xs font-semibold ${active ? "bg-emerald-300/10 text-emerald-200" : "bg-white/5 text-slate-400"}`}>
            {active ? activeLabel : inactiveLabel}
          </span>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-300">{description}</p>
      </InspectDetailHero>

      {effectContent}

      <div className="mt-4 grid gap-2 border-t border-white/10 pt-4 text-sm sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        {infoContent}
      </div>

      {statusReason ? (
        <div className="mt-4 rounded surface-inset px-3 py-2">
          <p className={`text-sm font-semibold ${statusReason.disabled ? "text-slate-400" : "text-emerald-200"}`}>
            {statusReason.label}
          </p>
          {statusReason.supportingLabel ? (
            <p className={`mt-1 text-sm font-semibold ${statusReason.disabled ? "text-slate-400" : "text-emerald-200"}`}>
              {statusReason.supportingLabel}
            </p>
          ) : null}
        </div>
      ) : null}

      {queue ? <StructureQueueProgress {...queue} /> : null}

      {notice?.tone === "error" ? (
        <div className="mt-2 break-words rounded border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-sm font-semibold text-rose-200">
          {notice.label}
        </div>
      ) : null}

      {inlineAction || inlineDemolishAction ? (
        <div className={inlineAction ? "mt-3 flex gap-2" : "mt-3 flex justify-end gap-2"}>
          {inlineAction ? (
            <button
              aria-label={inlineAction.ariaLabel}
              className="h-10 min-w-0 flex-1 rounded-md border border-signal/40 bg-signal/10 px-3 text-sm font-semibold text-signal transition hover:bg-signal/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
              disabled={inlineAction.disabled}
              onClick={inlineAction.onClick}
              type="button"
            >
              {inlineAction.label}
            </button>
          ) : null}
          {inlineAction && secondaryAction ? (
            <button
              aria-label={secondaryAction.ariaLabel}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-cyan-300/40 bg-cyan-300/10 text-cyan-200 transition hover:bg-cyan-300/20"
              onClick={secondaryAction.onClick}
              title={secondaryAction.ariaLabel}
              type="button"
            >
              <PackagePlus aria-hidden="true" size={16} strokeWidth={1.9} />
            </button>
          ) : null}
          {/* The destructive control goes last, after Upgrade's own Supply helper. */}
          {inlineDemolishAction ? <DemolishIconButton label={label} onClick={inlineDemolishAction.onClick} /> : null}
        </div>
      ) : null}

      {demolition ? (
        <div className="mt-3 rounded-md border border-rose-300/25 bg-rose-300/[0.06] px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-rose-100">
              <ArrowDown aria-hidden="true" className="shrink-0 text-rose-300" size={15} strokeWidth={2.2} />
              <span className="min-w-0 break-words">{demolition.label}</span>
              <span className="shrink-0 tabular-nums text-xs font-medium text-rose-200/80">{demolition.remaining}</span>
            </span>
            {demolition.onCancel ? (
              <button
                className="h-8 rounded-md border border-rose-300/40 bg-rose-300/10 px-3 text-xs font-semibold text-rose-100 transition hover:bg-rose-300/20 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={demolition.cancelDisabled}
                onClick={demolition.onCancel}
                type="button"
              >
                Cancel
              </button>
            ) : null}
          </div>
          <AnimatedProgressBar
            className="mt-2 h-1.5 w-full bg-black/25"
            fillClassName="bg-rose-300"
            indeterminate={demolition.indeterminate}
            label={`${demolition.label} progress`}
            value={demolition.progress}
          />
        </div>
      ) : null}

      {isInfoOpen && levelInfo ? (
        <LevelInfoModal
          columns={levelInfo.columns}
          costLabel={levelInfo.costLabel}
          currentLevel={levelInfo.currentLevel}
          itemLabel={label}
          onClose={() => setIsInfoOpen(false)}
          rows={levelInfo.rows}
        />
      ) : null}
    </InspectDetailShell>
  );
}

/**
 * Icon-only Demolish control that sits beside Upgrade. It is rendered only
 * while demolition is available, so it has no disabled state (#125).
 */
export function DemolishIconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      aria-label={`Demolish ${label}`}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-rose-300/20 text-rose-300/70 transition hover:border-rose-300/40 hover:bg-rose-300/10 hover:text-rose-200"
      onClick={onClick}
      title="Demolish"
      type="button"
    >
      <Bomb aria-hidden="true" size={16} strokeWidth={1.9} />
    </button>
  );
}

export function StructureQueueProgress({ completion, ...progress }: StructureQueue) {
  return (
    <div>
      <SingleItemQueueProgress {...progress} />
      {completion ? (
        <button
          className="mt-2 h-10 rounded border border-amber-200/30 bg-amber-200/10 px-3 text-xs font-semibold text-amber-100 disabled:cursor-not-allowed disabled:opacity-50 sm:h-8"
          disabled={completion.disabled}
          onClick={completion.onClick}
          title={completion.title}
          type="button"
        >
          {completion.label}
        </button>
      ) : null}
    </div>
  );
}
