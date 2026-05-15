import type { ComponentChildren } from "preact";

interface Props {
  children: ComponentChildren;
  gameMode?: boolean;
}

export function Layout({ children, gameMode }: Props) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-void text-white">
      {/* Subtle starfield background */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, rgba(128,241,255,0.04), transparent 40%), radial-gradient(circle at 80% 70%, rgba(246,179,92,0.03), transparent 40%)",
        }}
      />

      {gameMode && (
        <header className="relative z-20 flex items-center justify-between border-b border-white/10 bg-void/80 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="text-lg font-semibold tracking-tight text-white hover:text-signal"
            >
              Veydrift
            </a>
            <span className="hidden text-xs text-slate-600 sm:inline">
              Universe Exploration
            </span>
          </div>
          <nav className="flex items-center gap-2">
            <a
              href="#/universe"
              className="rounded px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              Universe
            </a>
            <a
              href={`#/galaxy/1/1`}
              className="rounded px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              Galaxy
            </a>
            <div className="ml-2 flex items-center gap-2 rounded border border-white/10 bg-white/5 px-3 py-1.5">
              <span className="text-xs text-slate-500">Wallet</span>
              <span className="font-mono text-xs text-slate-400">—</span>
            </div>
          </nav>
        </header>
      )}

      <main className="relative z-10">{children}</main>
    </div>
  );
}
