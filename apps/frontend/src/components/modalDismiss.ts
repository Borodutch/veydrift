// Imperative Escape-to-close binding for modals. Implemented as a ref callback
// (not a hook/component) so parent components stay safe to invoke as plain
// functions in tests — refs only run when Preact mounts real DOM.
export function escapeCloseRef(onClose: () => void) {
  let handler: ((event: KeyboardEvent) => void) | undefined;
  return (element: Element | null) => {
    if (element && !handler) {
      handler = (event: KeyboardEvent) => {
        if (event.key === "Escape") onClose();
      };
      window.addEventListener("keydown", handler);
      return;
    }
    if (!element && handler) {
      window.removeEventListener("keydown", handler);
      handler = undefined;
    }
  };
}

let globalDetailsCloseListenerAttached = false;

function ensureGlobalDetailsCloseListener() {
  if (globalDetailsCloseListenerAttached || typeof document === "undefined") return;
  globalDetailsCloseListenerAttached = true;
  document.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    document
      .querySelectorAll("details[data-close-outside][open]")
      .forEach((details) => {
        if (!details.contains(target)) {
          (details as HTMLDetailsElement).open = false;
        }
      });
  }, { passive: true });
}

// Marks a <details> element as close-on-outside-tap. One shared document
// listener closes any open [data-close-outside] details, so there is no
// per-element listener to leak. Ref callback form keeps components hook-free.
export function detailsCloseOutsideRef(element: Element | null) {
  if (element) ensureGlobalDetailsCloseListener();
}
