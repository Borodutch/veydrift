import { Info } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { Modal } from "./Modal";
import { ModalHeader } from "./ModalHeader";

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
  onSupply?: (() => void) | undefined;
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
      className="inline-flex h-10 w-10 items-center justify-center rounded surface-inset text-slate-300 transition hover:border-signal/40 hover:bg-signal/10 hover:text-signal sm:h-7 sm:w-7"
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

      <div className="min-h-0 overflow-auto overscroll-contain">
        <table className="level-info-table min-w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-10 bg-[#0d1829] text-xs uppercase tracking-normal text-cyan-300/70">
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
                <LevelInfoCell className="whitespace-nowrap" dataLabel="Level">
                  <span className="font-semibold text-white">Level {row.level}</span>
                  {row.level > currentLevel && row.onSupply ? <button
                    aria-label={`Supply ${itemLabel} Level ${row.level}`}
                    className="mt-2 block min-h-10 rounded border border-sky-300/40 bg-sky-300/10 px-3 text-xs font-semibold text-sky-200 hover:bg-sky-300/20"
                    onClick={row.onSupply} type="button">Supply</button> : null}
                </LevelInfoCell>
                <LevelInfoCell className="min-w-24" dataLabel="Status">
                  {row.status === "current" ? <LevelPill tone="current">Current</LevelPill> : null}
                  {row.status === "next" ? <LevelPill tone="next">Next</LevelPill> : null}
                </LevelInfoCell>
                {columns.map((column) => (
                  <LevelInfoCell className={column.cellClassName} dataLabel={column.label} key={column.key}>
                    {row.cells[column.key] ?? "N/A"}
                  </LevelInfoCell>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
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
  dataLabel,
}: {
  children: ComponentChildren;
  className?: string | undefined;
  dataLabel?: string | undefined;
}) {
  return (
    <td className={`border-b border-white/10 px-3 py-2 align-top text-slate-200 ${className}`} data-label={dataLabel}>
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
