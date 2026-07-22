import { Info } from "lucide-preact";
import type { JSX } from "preact";
import type { CombatStatBlock } from "../playableMvp";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const panelWidth = 288;
const panelGutter = 12;
const panelOffset = 8;
const panelMinHeight = 160;

export function CombatStatsInfoButton({
  label,
  stats,
}: {
  label: string;
  stats: CombatStatBlock;
}) {
  return (
    <details className="group relative inline-flex" onToggle={handlePanelToggle}>
      <summary
        aria-label={`Open ${label} combat stats`}
        className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-full border border-sky-300/35 bg-sky-300/10 text-sky-200 transition hover:border-sky-200/60 hover:bg-sky-300/20 focus:outline-none focus:ring-2 focus:ring-sky-300/40 sm:h-6 sm:w-6 [&::-webkit-details-marker]:hidden"
        onClick={handleSummaryInteraction}
        onFocus={handleSummaryInteraction}
        title="Combat stats"
      >
        <Info aria-hidden="true" size={13} strokeWidth={2.4} />
      </summary>
      <div
        className="fixed z-50 overflow-auto rounded border border-white/15 bg-[#111827] p-3 text-left shadow-2xl shadow-black/50"
        data-combat-stats-panel
        style={{
          left: "var(--combat-stats-panel-left, 0px)",
          maxHeight: "var(--combat-stats-panel-max-height, calc(100vh - 1.5rem))",
          top: "var(--combat-stats-panel-top, 0px)",
          width: "var(--combat-stats-panel-width, 18rem)",
        }}
      >
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-200">
          Battle stats
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
          {stats.rows.map((row) => (
            <div className="rounded border border-white/10 bg-black/25 px-2 py-1.5" key={row.label}>
              <dt className="text-[10px] uppercase tracking-wide text-slate-500">{row.label}</dt>
              <dd className="mt-0.5 truncate font-semibold text-slate-100">{formatCombatStatValue(row.value)}</dd>
              {row.hint && <p className="mt-1 text-[11px] leading-4 text-slate-400">{row.hint}</p>}
            </div>
          ))}
        </dl>
        {stats.notes.length > 0 && (
          <ul className="mt-2 grid gap-1 text-[11px] leading-4 text-slate-400">
            {stats.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

export function formatCombatStatValue(value: number | string): string {
  return typeof value === "number" ? formatter.format(value) : value;
}

function handlePanelToggle(event: JSX.TargetedEvent<HTMLDetailsElement, Event>) {
  const details = event.currentTarget;
  if (details.open) {
    schedulePanelPosition(details);
    watchOutsidePointerDown(details);
  } else {
    unwatchOutsidePointerDown(details);
  }
}

// While the panel is open, a pointerdown anywhere outside the details root closes it. Tracked
// imperatively (not via hooks) so the component stays callable as a plain function.
const outsidePointerDownWatchers = new WeakMap<HTMLDetailsElement, (event: PointerEvent) => void>();

function watchOutsidePointerDown(details: HTMLDetailsElement) {
  if (outsidePointerDownWatchers.has(details) || typeof document === "undefined") return;
  const handlePointerDown = (event: PointerEvent) => {
    if (event.target instanceof Node && details.contains(event.target)) return;
    details.open = false;
  };
  outsidePointerDownWatchers.set(details, handlePointerDown);
  document.addEventListener("pointerdown", handlePointerDown);
}

function unwatchOutsidePointerDown(details: HTMLDetailsElement) {
  const handlePointerDown = outsidePointerDownWatchers.get(details);
  if (!handlePointerDown) return;
  outsidePointerDownWatchers.delete(details);
  document.removeEventListener("pointerdown", handlePointerDown);
}

function handleSummaryInteraction(event: JSX.TargetedEvent<HTMLElement, Event>) {
  schedulePanelPosition(event.currentTarget.closest("details"));
}

function schedulePanelPosition(details: HTMLDetailsElement | null) {
  if (!details || typeof window === "undefined") {
    return;
  }

  positionPanel(details);
  window.requestAnimationFrame(() => positionPanel(details));
}

function positionPanel(details: HTMLDetailsElement) {
  const summary = details.querySelector("summary");
  const panel = details.querySelector<HTMLElement>("[data-combat-stats-panel]");

  if (!(summary instanceof HTMLElement) || !panel) {
    return;
  }

  const triggerRect = summary.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(panelWidth, Math.max(0, viewportWidth - panelGutter * 2));

  if (width <= 0) {
    return;
  }

  const left = clamp(
    triggerRect.right - width,
    panelGutter,
    viewportWidth - width - panelGutter,
  );
  const belowSpace = viewportHeight - triggerRect.bottom - panelOffset - panelGutter;
  const aboveSpace = triggerRect.top - panelOffset - panelGutter;
  const shouldOpenAbove = belowSpace < panelMinHeight && aboveSpace > belowSpace;
  let maxHeight: number;
  let top: number;

  if (shouldOpenAbove) {
    maxHeight = Math.min(
      Math.max(aboveSpace, panelMinHeight),
      viewportHeight - panelGutter * 2,
    );
    top = Math.max(
      panelGutter,
      triggerRect.top - panelOffset - Math.min(panel.getBoundingClientRect().height || maxHeight, maxHeight),
    );
  } else {
    top = Math.min(triggerRect.bottom + panelOffset, viewportHeight - panelGutter);
    maxHeight = Math.min(
      Math.max(viewportHeight - top - panelGutter, panelMinHeight),
      viewportHeight - panelGutter * 2,
    );
  }

  details.style.setProperty("--combat-stats-panel-left", `${Math.round(left)}px`);
  details.style.setProperty("--combat-stats-panel-max-height", `${Math.round(maxHeight)}px`);
  details.style.setProperty("--combat-stats-panel-top", `${Math.round(top)}px`);
  details.style.setProperty("--combat-stats-panel-width", `${Math.round(width)}px`);
}

function clamp(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}
