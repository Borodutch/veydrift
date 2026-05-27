import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { LucideIcon } from "lucide-preact";
import { ArrowLeftRight, Factory, FlaskConical, Menu, Moon, Orbit, Radar, Rocket, SatelliteDish, Shield, Trophy, Users, X } from "lucide-preact";

import { shortAddress } from "../walletFlow";

export type Page =
  | "overview"
  | "infrastructure"
  | "defenses"
  | "research"
  | "shipyard"
  | "mission-control"
  | "moon"
  | "alliance"
  | "rift"
  | "rankings"
  | "galaxy"
  | "planet";

interface NavBarProps {
  active: Page;
  coordinates?: string | undefined;
  account?: string | undefined;
  mobileMenuOpen: boolean;
  mobilePlanetSelector?: ComponentChildren;
  onMobileMenuOpenChange: (open: boolean) => void;
  onNavigate: (page: Page) => void;
}

const pages: Array<{ key: Page; label: string; mobileLabel: string; icon: LucideIcon }> = [
  { key: "overview", label: "Overview", mobileLabel: "Overview", icon: Radar },
  { key: "infrastructure", label: "Infrastructure", mobileLabel: "Infra", icon: Factory },
  { key: "defenses", label: "Defenses", mobileLabel: "Defense", icon: Shield },
  { key: "research", label: "Research", mobileLabel: "Research", icon: FlaskConical },
  { key: "shipyard", label: "Shipyard", mobileLabel: "Shipyard", icon: Rocket },
  { key: "mission-control", label: "Mission Control", mobileLabel: "Mission", icon: SatelliteDish },
  { key: "moon", label: "Moon", mobileLabel: "Moon", icon: Moon },
  { key: "alliance", label: "Alliance", mobileLabel: "Ally", icon: Users },
  { key: "rift", label: "Rift", mobileLabel: "Rift", icon: ArrowLeftRight },
  { key: "rankings", label: "Rankings", mobileLabel: "Ranks", icon: Trophy },
  { key: "galaxy", label: "Galaxy", mobileLabel: "Galaxy", icon: Orbit },
];

export function mobileNavigationButtonLabel(open: boolean): string {
  return open ? "Close navigation menu" : "Open navigation menu";
}

export function NavBar({
  active,
  account,
  coordinates,
  mobileMenuOpen,
  mobilePlanetSelector,
  onMobileMenuOpenChange,
  onNavigate,
}: NavBarProps) {
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mobileMenuOpen || typeof document === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onMobileMenuOpenChange(false);
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && mobileMenuRef.current?.contains(target)) return;
      onMobileMenuOpenChange(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [mobileMenuOpen, onMobileMenuOpenChange]);

  const navigateFromMobile = (page: Page) => {
    onNavigate(page);
    onMobileMenuOpenChange(false);
  };

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden w-52 shrink-0 flex-col border-r border-white/10 bg-[#0a0f1a] md:flex">
        <div className="flex min-h-[calc(100dvh-52px)] flex-col gap-4 bg-[linear-gradient(180deg,rgba(20,29,45,0.82),rgba(8,12,23,0.98))] p-3 shadow-[inset_-1px_0_rgba(255,255,255,0.04)]">
          <div className="border-b border-white/10 px-2 pb-3">
            <p className="text-sm font-semibold text-white">
              Veydrift
            </p>
          </div>

          <div className="grid gap-1">
            {pages.map((page) => (
              <NavItem
                active={active === page.key || (active === "planet" && page.key === "galaxy")}
                icon={page.icon}
                key={page.key}
                label={page.label}
                onClick={() => onNavigate(page.key)}
              />
            ))}
          </div>

          <div className="mt-auto rounded-md border border-white/10 bg-black/20 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Home Planet
            </p>
            <p className="mt-1 font-mono text-sm text-slate-100">
              {coordinates ?? "--:--:--"}
            </p>
            <div className="mt-3 h-px bg-white/10" />
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Wallet
            </p>
            <p className="mt-1 truncate font-mono text-xs text-slate-300">
              {account ? shortAddress(account) : "Disconnected"}
            </p>
          </div>
        </div>
      </nav>

      <div className="relative z-30 w-screen max-w-[100vw] self-start border-b border-white/10 bg-[#0c111b]/95 backdrop-blur md:hidden" ref={mobileMenuRef}>
        <div className="relative flex min-h-12 items-center gap-3 px-3 pr-16">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">Veydrift</p>
            <p className="truncate font-mono text-[11px] text-slate-400">
              {coordinates ?? (account ? shortAddress(account) : "Disconnected")}
            </p>
          </div>
          <button
            aria-controls="mobile-navigation-menu"
            aria-expanded={mobileMenuOpen}
            aria-label={mobileNavigationButtonLabel(mobileMenuOpen)}
            className="fixed right-3 top-[4.75rem] z-50 grid h-10 w-10 shrink-0 place-items-center rounded border border-white/10 bg-[#111827]/95 text-slate-100 shadow-lg shadow-black/30 transition hover:border-cyan-200/50 hover:bg-cyan-300/10 focus:outline-none focus:ring-2 focus:ring-cyan-300/50"
            onClick={() => onMobileMenuOpenChange(!mobileMenuOpen)}
            type="button"
          >
            {mobileMenuOpen ? <X aria-hidden="true" size={19} strokeWidth={2} /> : <Menu aria-hidden="true" size={20} strokeWidth={2} />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div
            className="absolute left-0 right-0 top-full max-h-[calc(100dvh-98px)] overflow-y-auto border-b border-white/10 bg-[#080d18]/[0.98] p-3 shadow-2xl shadow-black/40"
            id="mobile-navigation-menu"
          >
            <nav aria-label="Mobile app navigation" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {pages.map((page) => (
                <MobileMenuItem
                  active={active === page.key || (active === "planet" && page.key === "galaxy")}
                  key={page.key}
                  icon={page.icon}
                  label={page.label}
                  onClick={() => navigateFromMobile(page.key)}
                />
              ))}
            </nav>

            {mobilePlanetSelector ? (
              <div className="mt-3 border-t border-white/10 pt-3">
                {mobilePlanetSelector}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}

function NavItem({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm transition ${
        active
          ? "bg-white/10 font-medium text-white"
          : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
      }`}
      onClick={onClick}
      type="button"
      aria-current={active ? "page" : undefined}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded border border-white/10 bg-black/20 text-slate-300 opacity-90">
        <Icon aria-hidden="true" size={15} strokeWidth={1.9} />
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function MobileMenuItem({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex h-12 min-w-0 items-center justify-start gap-2 rounded border px-2 text-left text-xs font-medium transition ${
        active
          ? "border-cyan-300/50 bg-cyan-300/10 text-cyan-100"
          : "border-white/10 bg-white/[0.045] text-slate-300 hover:border-cyan-200/40 hover:bg-white/[0.075]"
      }`}
      onClick={onClick}
      type="button"
      aria-current={active ? "page" : undefined}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded border border-white/10 bg-black/20">
        <Icon aria-hidden="true" size={15} strokeWidth={1.9} />
      </span>
      <span className="min-w-0 truncate leading-none">{label}</span>
    </button>
  );
}
