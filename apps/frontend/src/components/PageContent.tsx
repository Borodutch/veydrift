import type { ComponentChildren } from "preact";
import { Suspense } from "preact/compat";
import { useErrorBoundary } from "preact/hooks";

/** Loading or a failed route chunk must never replace the app shell/store. */
export function PageContent({ children, fallback }: { children: ComponentChildren; fallback: ComponentChildren }) {
  const [error] = useErrorBoundary();
  if (error) return (
    <section role="alert" className="rounded-md border border-white/10 bg-[#101624] p-4">
      <p>This page could not be loaded.</p>
      <button className="btn-secondary mt-3" onClick={() => window.location.reload()} type="button">Reload to try again</button>
    </section>
  );
  return <Suspense fallback={fallback}>{children}</Suspense>;
}
