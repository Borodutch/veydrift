import { Info, PackagePlus, type LucideIcon } from "lucide-preact";
import type { ComponentChildren, JSX } from "preact";
import { formatCost, formatLevelAmount } from "../buildingDetails";

export { formatLevelAmount };
import type { Resources } from "../playableMvp";
import { Modal } from "./Modal";
import { ModalHeader } from "./ModalHeader";

export type LevelInfoColumn = {
  key: string;
  label: string;
  /** Shown before the value on phones, where secondary stats share one line under the cost. */
  icon?: LucideIcon | undefined;
  /** Desktop grid track; defaults to a flexible stat column. */
  width?: string | undefined;
  /** Let long text wrap (research requirements) instead of truncating to one line. */
  wrap?: boolean | undefined;
  /** On phones this stat may shrink (with an ellipsis) to keep the stat line on one line. */
  shrink?: boolean | undefined;
};

export type LevelInfoRow = {
  cells: Readonly<Record<string, ComponentChildren>>;
  cost: Resources;
  key: string | number;
  level: number;
  status: "current" | "next" | "future";
  onSupply?: (() => void) | undefined;
};

const resourceKeys = ["metal", "crystal", "deuterium"] as const;
const resourceGlyphs: Record<keyof Resources | "energy", { abbr: string; className: string }> = {
  metal: { abbr: "M", className: "text-amber-300" },
  crystal: { abbr: "C", className: "text-cyan-300" },
  deuterium: { abbr: "D", className: "text-emerald-300" },
  energy: { abbr: "E", className: "text-lime-300" },
};
/** Colored resource letter matching the top bar (M/C/D/E). */
export function levelResourceGlyph(resource: keyof Resources | "energy"): JSX.Element {
  const glyph = resourceGlyphs[resource];
  return <span aria-hidden="true" className={`text-[0.65rem] font-bold ${glyph.className}`}>{glyph.abbr}</span>;
}

/** A level stat with an optional subtle delta (e.g. 5,277/h +2K). */
export function levelInfoValue(value: string, options: { delta?: number | undefined; note?: string | undefined; resource?: keyof Resources | "energy" | undefined; suffix?: string | undefined; tone?: "positive" | "warning" | undefined } = {}): JSX.Element {
  const { delta, note, resource, suffix = "", tone = "positive" } = options;
  const deltaText = delta !== undefined && Math.trunc(delta) !== 0 ? `${delta > 0 ? "+" : ""}${formatLevelAmount(delta, 1_000)}` : note;
  // The value and its delta share a one-line wrapping box (.level-info-value): when the cell is too
  // narrow the delta wraps onto the hidden second line and disappears whole, never as "+10…".
  return (
    <span className="level-info-value">
      <span className="min-w-0 truncate">
        {resource ? <span className="mr-1">{levelResourceGlyph(resource)}</span> : null}
        <span className="tabular-nums text-slate-200">{value}{suffix}</span>
      </span>
      {deltaText ? (
        <span className={`level-info-delta text-[0.68rem] tabular-nums ${tone === "warning" ? "text-amber-200/70" : "text-emerald-300/70"}`}>
          {deltaText}
        </span>
      ) : null}
    </span>
  );
}

export function LevelInfoButton({
  itemLabel,
  onClick,
}: {
  itemLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={`Open ${itemLabel} level table`}
      className="inline-flex h-10 w-10 items-center justify-center rounded surface-inset text-slate-300 transition hover:border-signal/40 hover:bg-signal/10 hover:text-signal sm:h-7 sm:w-7"
      onClick={onClick}
      title="Level table"
      type="button"
    >
      <Info aria-hidden="true" size={15} strokeWidth={2.2} />
    </button>
  );
}

// Ref callback (not a hook) so the modal stays callable as a plain function in tests. Opening a
// long table scrolls once so the current level sits near the top with two earlier levels for context.
const scrolledLevelTables = new WeakSet<Element>();

// Same limit as the Supply planner (levelSupply.ts): a range whose summed cost exceeds it always
// fails closed, so it gets no Supply icon.
const SUPPLY_COST_LIMIT = Math.floor(Number.MAX_SAFE_INTEGER / 3);
function supplyableLevels(rows: readonly LevelInfoRow[], currentLevel: number): Set<number> {
  const total = { metal: 0, crystal: 0, deuterium: 0 };
  const levels = new Set<number>();
  for (const row of [...rows].sort((a, b) => a.level - b.level)) {
    if (row.level <= currentLevel) continue;
    for (const key of resourceKeys) total[key] += row.cost[key];
    if (row.onSupply && resourceKeys.every((key) => total[key] <= SUPPLY_COST_LIMIT)) levels.add(row.level);
  }
  return levels;
}
function scrollToCurrentLevel(container: HTMLDivElement | null) {
  if (!container || scrolledLevelTables.has(container)) return;
  scrolledLevelTables.add(container);
  const row = container.querySelector<HTMLElement>('[data-level-status="current"]');
  if (!row) return;
  const header = container.querySelector<HTMLElement>("[data-level-info-head]");
  container.scrollTop = Math.max(0, row.offsetTop - (header?.offsetHeight ?? 0) - row.offsetHeight * 2);
}

export function LevelInfoModal({
  columns,
  costLabel = "Upgrade cost",
  currentLevel,
  itemLabel,
  onClose,
  rows,
}: {
  columns: readonly LevelInfoColumn[];
  costLabel?: string | undefined;
  currentLevel: number;
  itemLabel: string;
  onClose: () => void;
  rows: readonly LevelInfoRow[];
}) {
  const titleId = "level-info-title";
  const supplyable = supplyableLevels(rows, currentLevel);
  const hasSupply = supplyable.size > 0;
  const desktopColumns = [
    "5.5rem",
    "minmax(12.5rem,2fr)",
    ...columns.map((column) => column.width ?? "minmax(6.5rem,1fr)"),
    ...(hasSupply ? ["2rem"] : []),
  ].join(" ");

  // Modal portals to document.body, so sticky detail panels never cover this layer.
  return (
    <Modal
      labelledBy={titleId}
      layerAttributes={{ "data-level-info-layer": "viewport" }}
      onClose={onClose}
      panelClassName="grid max-w-4xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-h-[min(44rem,calc(100dvh-3rem))]"
    >
      <div className="border-b border-cyan-300/10 px-4 py-3">
        <ModalHeader closeLabel="Close level table" onClose={onClose} subtitle={`Current Level ${currentLevel}`} title={`${itemLabel} levels`} titleId={titleId} />
      </div>

      <div className="relative min-h-0 overflow-auto overscroll-contain" ref={scrollToCurrentLevel}>
        <div
          aria-labelledby={titleId}
          className={`level-info-grid text-sm ${hasSupply ? "level-info-grid--supply" : ""}`}
          role="table"
          style={{ "--level-info-columns": desktopColumns }}
        >
          <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0d1829]" data-level-info-head role="rowgroup">
            <div className="level-info-row py-2 text-[0.65rem] font-semibold uppercase tracking-normal text-cyan-300/70" role="row">
              <span className="level-info-level" role="columnheader">Level</span>
              <span className="level-info-cost truncate" role="columnheader">{costLabel}</span>
              <div className="level-info-meta flex-wrap">
                {columns.map((column) => (
                  <span className="inline-flex min-w-0 items-center gap-1 truncate" key={column.key} role="columnheader" title={column.label}>
                    {column.icon ? <column.icon aria-hidden="true" className="shrink-0 lg:hidden" size={11} strokeWidth={2.2} /> : null}
                    <span className="truncate" data-level-fit="header">{column.label}</span>
                  </span>
                ))}
              </div>
              {hasSupply ? <span className="level-info-supply" role="columnheader"><span className="sr-only">Supply</span></span> : null}
            </div>
          </div>
          <div role="rowgroup">
            {rows.map((row) => levelInfoRow(row, columns, currentLevel, hasSupply, supplyable.has(row.level)))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function levelInfoRow(row: LevelInfoRow, columns: readonly LevelInfoColumn[], currentLevel: number, hasSupply: boolean, supplyable: boolean) {
  const past = row.level < currentLevel;
  const tone = row.status === "current"
    ? "bg-emerald-300/[0.08] shadow-[inset_3px_0_0_rgba(110,231,183,0.75)]"
    : row.status === "next"
      ? "bg-signal/[0.08] shadow-[inset_3px_0_0_rgba(128,241,255,0.75)]"
      : past
        ? "opacity-50"
        : "even:bg-white/[0.02]";
  const supplyLabel = `Supply resources up to Level ${row.level}`;

  return (
    <div
      className={`level-info-row border-b border-white/[0.06] lg:min-h-11 ${tone}`}
      data-level-status={past ? "past" : row.status}
      key={row.key}
      role="row"
    >
      <span className="level-info-level flex min-w-0 flex-col items-start gap-0.5 lg:flex-row lg:items-center lg:gap-2" role="rowheader">
        <span className="whitespace-nowrap font-mono text-sm font-semibold tabular-nums text-white"><span className="sr-only">Level </span>{row.level}</span>
        {row.status === "current" ? levelPill("Current", "current") : null}
        {row.status === "next" ? levelPill("Next", "next") : null}
      </span>
      <span className="level-info-cost min-w-0" role="cell">{levelCost(row.cost)}</span>
      <div className={`level-info-meta text-xs text-slate-400 lg:text-sm ${columns.some((column) => column.wrap) ? "flex-wrap" : ""}`} data-level-fit="box">
        {columns.map((column) => {
          const value = row.cells[column.key];
          return (
            <span
              className={`inline-flex min-w-0 items-center gap-1 ${column.wrap ? "basis-full lg:basis-auto" : column.shrink ? "whitespace-nowrap" : "shrink-0 whitespace-nowrap"}`}
              key={column.key}
              role="cell"
              title={typeof value === "string" ? `${column.label}: ${value}` : column.label}
            >
              {column.icon ? <column.icon aria-hidden="true" className="shrink-0 text-slate-500 lg:hidden" size={11} strokeWidth={2.2} /> : null}
              <span className={column.wrap ? "min-w-0 break-words" : "min-w-0 truncate"} data-level-fit={column.key === "effect" ? "text" : "value"}>{value ?? <span className="text-slate-600">—</span>}</span>
            </span>
          );
        })}
      </div>
      {hasSupply ? (
        <span className="level-info-supply flex justify-end" role="cell">
          {supplyable ? (
            <button
              aria-label={supplyLabel}
              className="relative inline-flex h-8 w-8 items-center justify-center rounded border border-sky-300/25 before:absolute before:-inset-[5px] before:content-[''] bg-sky-300/[0.06] text-sky-200 transition hover:border-sky-300/50 hover:bg-sky-300/15 hover:text-sky-100"
              onClick={row.onSupply}
              title={supplyLabel}
              type="button"
            >
              <PackagePlus aria-hidden="true" size={15} strokeWidth={2} />
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function levelCost(cost: Resources) {
  const entries = resourceKeys.filter((key) => cost[key] > 0);
  if (entries.length === 0) return <span className="text-slate-500">No cost</span>;
  const exact = formatCost(cost);
  return (
    <>
      <span className="sr-only">{exact}</span>
      <span aria-hidden="true" className="flex min-w-0 items-baseline gap-x-2 overflow-hidden whitespace-nowrap lg:gap-x-2.5" data-level-fit title={exact}>
        {entries.map((key) => (
          <span className="inline-flex items-baseline gap-1" key={key}>
            {levelResourceGlyph(key)}
            <span className="tabular-nums text-slate-100">{formatLevelAmount(cost[key])}</span>
          </span>
        ))}
      </span>
    </>
  );
}

function levelPill(children: string, tone: "current" | "next") {
  const className = tone === "current"
    ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
    : "border-signal/30 bg-signal/10 text-signal";

  return (
    <span className={`inline-flex whitespace-nowrap rounded border px-1 text-[0.58rem] font-semibold uppercase leading-4 tracking-normal ${className}`}>
      {children}
    </span>
  );
}
