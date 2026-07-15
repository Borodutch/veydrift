import { Info, X } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";

export type LevelInfoColumn = {
  cellClassName?: string | undefined;
  headerClassName?: string | undefined;
  key: string;
  label: string;
};

export type LevelInfoRow = {
  cells: Readonly<Record<string, ComponentChildren>>;
  key: string | number;
  level: number;
  status: "current" | "next" | "future";
};

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
      className="inline-flex h-7 w-7 items-center justify-center rounded border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-signal/40 hover:bg-signal/10 hover:text-signal"
      onClick={onClick}
      title="Level table"
      type="button"
    >
      <Info aria-hidden="true" size={15} strokeWidth={2.2} />
    </button>
  );
}

export function LevelInfoModal({
  columns,
  currentLevel,
  itemLabel,
  onClose,
  rows,
}: {
  columns: readonly LevelInfoColumn[];
  currentLevel: number;
  itemLabel: string;
  onClose: () => void;
  rows: readonly LevelInfoRow[];
}) {
  const titleId = "level-info-title";
  const layer = (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-2 sm:p-3"
      data-level-info-layer="viewport"
      role="dialog"
    >
      <div className="grid max-h-[calc(100dvh-1rem)] w-full max-w-4xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-white/10 bg-[#0f1624] shadow-2xl shadow-black/40 sm:max-h-[min(44rem,calc(100dvh-1.5rem))]">
        <div className="flex min-w-0 items-start justify-between gap-3 border-b border-white/10 px-3 py-3 sm:px-4">
          <div className="min-w-0">
            <h3 id={titleId} className="break-words text-base font-semibold text-white">
              {itemLabel} levels
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Current Level {currentLevel}
            </p>
          </div>
          <button
            aria-label="Close level table"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={16} strokeWidth={2.2} />
          </button>
        </div>

        <div className="min-h-0 overflow-auto overscroll-contain">
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-10 bg-[#111827] text-xs uppercase tracking-normal text-slate-400">
              <tr>
                <LevelInfoHeader className="min-w-24 whitespace-nowrap">Level</LevelInfoHeader>
                <LevelInfoHeader className="min-w-24 whitespace-nowrap">Status</LevelInfoHeader>
                {columns.map((column) => (
                  <LevelInfoHeader className={column.headerClassName} key={column.key}>
                    {column.label}
                  </LevelInfoHeader>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  className={`border-t border-white/10 ${
                    row.status === "current"
                      ? "bg-emerald-300/10"
                      : row.status === "next"
                        ? "bg-signal/10"
                        : "odd:bg-white/[0.015]"
                  }`}
                  key={row.key}
                >
                  <LevelInfoCell className="whitespace-nowrap">
                    <span className="font-semibold text-white">Level {row.level}</span>
                  </LevelInfoCell>
                  <LevelInfoCell className="min-w-24">
                    {row.status === "current" ? <LevelPill tone="current">Current</LevelPill> : null}
                    {row.status === "next" ? <LevelPill tone="next">Next</LevelPill> : null}
                  </LevelInfoCell>
                  {columns.map((column) => (
                    <LevelInfoCell className={column.cellClassName} key={column.key}>
                      {row.cells[column.key] ?? "N/A"}
                    </LevelInfoCell>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // Detail panels become sticky stacking contexts on desktop. Portaling this layer
  // keeps ship and defense detail cards below it regardless of their DOM order.
  return typeof document === "undefined" ? layer : createPortal(layer, document.body);
}

function LevelInfoHeader({
  children,
  className = "",
}: {
  children: ComponentChildren;
  className?: string | undefined;
}) {
  return (
    <th className={`border-b border-white/10 px-3 py-2 font-semibold ${className}`}>
      {children}
    </th>
  );
}

function LevelInfoCell({
  children,
  className = "",
}: {
  children: ComponentChildren;
  className?: string | undefined;
}) {
  return (
    <td className={`border-b border-white/10 px-3 py-2 align-top text-slate-200 ${className}`}>
      {children}
    </td>
  );
}

function LevelPill({ children, tone }: { children: string; tone: "current" | "next" }) {
  const className = tone === "current"
    ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
    : "border-signal/30 bg-signal/10 text-signal";

  return (
    <span className={`inline-flex whitespace-nowrap rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-normal ${className}`}>
      {children}
    </span>
  );
}
