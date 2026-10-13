import { ArrowDown, Clock, LandPlot, TrendingDown } from "lucide-preact";
import { formatNumber } from "../buildingDetails";
import { formatDuration } from "../durationFormat";
import type { Resources } from "../playableMvp";
import { Modal } from "./Modal";
import { ModalHeader } from "./ModalHeader";

const RESOURCE_ROWS = [
  { key: "metal", label: "Metal" },
  { key: "crystal", label: "Crystal" },
  { key: "deuterium", label: "Deuterium" },
] as const;

/** Confirmation for taking a planet or moon building down one level. */
export function DemolitionDialog({
  buildingLabel,
  consequences,
  cost,
  currentLevel,
  discountPercent,
  durationSeconds,
  onCancel,
  onConfirm,
  pending,
}: {
  buildingLabel: string;
  /** Short lines describing what drops, e.g. "Metal production −1,234/h". */
  consequences: readonly string[];
  cost: Resources;
  currentLevel: number;
  discountPercent: number;
  durationSeconds: number;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const priced = RESOURCE_ROWS.filter(({ key }) => cost[key] > 0);
  return (
    <Modal dismissible={!pending} labelledBy="demolition-title" onClose={onCancel} panelClassName="max-w-md border-rose-300/30 p-4">
      <ModalHeader
        closeDisabled={pending}
        closeLabel="Close demolition dialog"
        onClose={onCancel}
        subtitle={(
          <span className="inline-flex items-center gap-1 font-semibold text-rose-200">
            Level {currentLevel}
            <ArrowDown aria-label="to" size={12} strokeWidth={2.2} />
            {currentLevel - 1}
          </span>
        )}
        title={`Demolish ${buildingLabel}`}
        titleId="demolition-title"
      />

      <div className="mt-4 rounded surface-inset px-3 py-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-slate-200">Cost</span>
          {discountPercent > 0 ? (
            <span className="rounded bg-emerald-300/10 px-2 py-0.5 text-xs font-semibold text-emerald-200">
              −{Math.min(100, discountPercent)}% Ion Tech
            </span>
          ) : null}
        </div>
        {priced.length > 0 ? (
          <dl className="mt-2 grid gap-1">
            {priced.map(({ key, label }) => (
              <div className="flex justify-between gap-2" key={key}>
                <dt className="text-slate-400">{label}</dt>
                <dd className="font-semibold tabular-nums text-slate-100">{formatNumber(cost[key])}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-2 font-semibold text-emerald-200">Free</p>
        )}
      </div>

      <ul className="mt-3 grid gap-2 text-sm">
        <li className="flex items-center gap-2 text-slate-300">
          <Clock aria-hidden="true" className="shrink-0 text-slate-400" size={15} strokeWidth={2} />
          <span>Takes {formatDuration(durationSeconds)}</span>
        </li>
        <li className="flex items-center gap-2 text-slate-300">
          <LandPlot aria-hidden="true" className="shrink-0 text-emerald-300" size={15} strokeWidth={2} />
          <span>+1 free field</span>
        </li>
        {consequences.map((line) => (
          <li className="flex items-center gap-2 text-rose-100" key={line}>
            <TrendingDown aria-hidden="true" className="shrink-0 text-rose-300" size={15} strokeWidth={2} />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex justify-end gap-2">
        <button className="rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10 disabled:opacity-50" disabled={pending} onClick={onCancel} type="button">
          Keep building
        </button>
        <button className="rounded border border-rose-300/40 bg-rose-300/10 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-300/20 disabled:cursor-not-allowed disabled:opacity-50" disabled={pending} onClick={onConfirm} type="button">
          {pending ? "Confirm in wallet…" : `Demolish to level ${currentLevel - 1}`}
        </button>
      </div>
    </Modal>
  );
}
