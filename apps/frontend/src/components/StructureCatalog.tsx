import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { QueueTimeline } from "../playableMvp";
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
  isDimmed: boolean;
  key: Key;
  label: string;
  labelTone?: "normal" | "muted" | undefined;
  statusText?: string | undefined;
  statusTone?: "accent" | "warning" | undefined;
};

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
  description: string;
  effectContent?: ComponentChildren | undefined;
  inactiveLabel?: string | undefined;
  infoContent: ComponentChildren;
  isDimmed: boolean;
  label: string;
  levelInfo?: StructureLevelInfo | undefined;
  notice?: { label: string; tone: "error" | "success" } | undefined;
  queue?: StructureQueue | undefined;
  secondaryAction?: { ariaLabel: string; label: string; onClick: () => void } | undefined;
  statusReason?: { disabled: boolean; label: string; supportingLabel?: string | undefined } | undefined;
  summary: string;
}) {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
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
        <div className="mt-4 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
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

      {action ? (
        <div className={`mt-3 grid gap-2 ${secondaryAction ? "grid-cols-2" : "grid-cols-1"}`}>
          <button
            aria-label={action.ariaLabel}
            className="h-10 w-full rounded-md border border-signal/40 bg-signal/10 px-3 text-sm font-semibold text-signal transition hover:bg-signal/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            disabled={action.disabled}
            onClick={action.onClick}
            type="button"
          >
            {action.label}
          </button>
          {secondaryAction ? (
            <button
              aria-label={secondaryAction.ariaLabel}
              className="h-10 w-full rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
              onClick={secondaryAction.onClick}
              type="button"
            >
              {secondaryAction.label}
            </button>
          ) : null}
        </div>
      ) : null}

      {isInfoOpen && levelInfo ? (
        <LevelInfoModal
          columns={levelInfo.columns}
          currentLevel={levelInfo.currentLevel}
          itemLabel={label}
          onClose={() => setIsInfoOpen(false)}
          rows={levelInfo.rows}
        />
      ) : null}
    </InspectDetailShell>
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
