import type { ComponentChildren, JSX } from "preact";
import { createPortal } from "preact/compat";

// Open modals share one scroll lock: the page (and the desktop app scrollport) stop scrolling under any popup.
let lockedModals = 0;

function setScrollLocked(locked: boolean) {
  if (typeof document === "undefined") return;
  const targets = [document.documentElement, document.querySelector<HTMLElement>("[data-app-scrollport]")];
  for (const target of targets) {
    if (!target) continue;
    if (locked) target.style.setProperty("overflow", "hidden");
    else target.style.removeProperty("overflow");
  }
}

// Ref callback (not a hook) so callers stay safe to invoke as plain functions in tests; it only runs
// when Preact mounts real DOM. Each render hands over a fresh callback, so Escape always sees the
// current onClose; the counter keeps the lock stable across those hand-overs and nested modals.
function modalLifecycleRef(onClose: () => void, closeOnEscape: boolean) {
  let handler: ((event: KeyboardEvent) => void) | undefined;
  return (element: Element | null) => {
    if (element && !handler) {
      handler = (event: KeyboardEvent) => {
        if (closeOnEscape && event.key === "Escape") onClose();
      };
      window.addEventListener("keydown", handler);
      lockedModals += 1;
      if (lockedModals === 1) setScrollLocked(true);
      return;
    }
    if (!element && handler) {
      window.removeEventListener("keydown", handler);
      handler = undefined;
      lockedModals = Math.max(0, lockedModals - 1);
      if (lockedModals === 0) setScrollLocked(false);
    }
  };
}

/**
 * The one popup shell: a full-screen dimmed backdrop rendered on document.body (above every sticky bar),
 * a centered panel, Escape and backdrop-click to close, and a page scroll lock while open.
 */
export function Modal({
  as: Panel = "div",
  children,
  closeOnEscape = true,
  dismissible = true,
  id,
  label,
  labelledBy,
  layerAttributes,
  onClose,
  onSubmit,
  panelClassName = "",
  panelRef,
}: {
  as?: "div" | "form" | "section";
  children: ComponentChildren;
  /** Set false when the dialog runs its own keyboard handling (for example a focus trap). */
  closeOnEscape?: boolean;
  /** False while a transaction is pending: Escape and backdrop clicks are ignored. */
  dismissible?: boolean;
  id?: string | undefined;
  label?: string | undefined;
  labelledBy?: string | undefined;
  layerAttributes?: Record<string, string> | undefined;
  onClose: () => void;
  onSubmit?: ((event: JSX.TargetedSubmitEvent<HTMLFormElement>) => void) | undefined;
  panelClassName?: string;
  panelRef?: ((element: HTMLElement | null) => void) | { current: HTMLElement | null } | undefined;
}) {
  const layer = (
    <div
      className="modal-backdrop-enter modal-backdrop"
      onClick={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
      ref={modalLifecycleRef(onClose, closeOnEscape && dismissible)}
      {...layerAttributes}
    >
      <Panel
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={`modal-panel-enter modal-panel ${panelClassName}`}
        id={id}
        onSubmit={onSubmit as never}
        ref={panelRef as never}
        role="dialog"
      >
        {children}
      </Panel>
    </div>
  );
  return typeof document === "undefined" ? layer : createPortal(layer, document.body);
}
