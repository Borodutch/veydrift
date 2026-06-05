import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
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
  | "planet"
  | "battle-report"
  | "player-inspect"
  | "alliance-inspect";

interface NavBarProps {
  active: Page;
  coordinates?: string | undefined;
  account?: string | undefined;
  mobilePlanetSelector?: ComponentChildren | undefined;
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

export function NavBar({ active, account, coordinates, mobilePlanetSelector, onNavigate }: NavBarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen]);

  const handleMobileNavigate = (page: Page) => {
    onNavigate(page);
    setMobileMenuOpen(false);
  };

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden h-[calc(100dvh-2.75rem)] w-52 shrink-0 flex-col border-r border-white/10 bg-[#0a0f1a] md:sticky md:top-11 md:flex">
        <div className="flex min-h-0 flex-1 flex-col gap-3 bg-[linear-gradient(180deg,rgba(20,29,45,0.82),rgba(8,12,23,0.98))] p-3 shadow-[inset_-1px_0_rgba(255,255,255,0.04)]">
          <div className="border-b border-white/10 px-2 pb-3">
            <p className="text-sm font-semibold text-white">
              Veydrift
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {pages.map((page) => (
              <NavItem
                active={active === page.key || (active === "planet" && page.key === "galaxy") || (active === "alliance-inspect" && page.key === "alliance") || (active === "player-inspect" && page.key === "rankings")}
                icon={page.icon}
                key={page.key}
                label={page.label}
                onClick={() => onNavigate(page.key)}
              />
            ))}
          </div>

          <div className="sticky bottom-3 shrink-0 rounded-md border border-white/10 bg-[#07101d]/95 p-2 shadow-2xl shadow-black/30 backdrop-blur" aria-label="Sidebar account summary">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase text-slate-500">
                Home
              </span>
              <span className="truncate font-mono text-xs text-slate-100">
                {coordinates ?? "--:--:--"}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-white/10 pt-1.5">
              <span className="text-[10px] font-semibold uppercase text-slate-500">
                Wallet
              </span>
              <span className="truncate font-mono text-xs text-slate-300">
                {account ? shortAddress(account) : "Disconnected"}
              </span>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile navigation */}
      <div className="border-b border-white/10 bg-[#0c111b]/95 backdrop-blur md:hidden">
        <div className="flex h-12 items-center justify-between gap-3 px-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">Veydrift</p>
            <p className="font-mono text-[11px] leading-none text-slate-500">
              {coordinates ?? "--:--:--"}
            </p>
          </div>
          <button
            aria-controls="mobile-navigation-menu"
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            className="grid h-9 w-9 shrink-0 place-items-center rounded border border-white/10 bg-white/[0.06] text-slate-100 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-300/60"
            onClick={() => setMobileMenuOpen((open) => !open)}
            type="button"
          >
            {mobileMenuOpen ? <X aria-hidden="true" size={18} strokeWidth={2} /> : <Menu aria-hidden="true" size={18} strokeWidth={2} />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div
            className="grid gap-3 border-t border-white/10 bg-[#08101d]/98 p-3 shadow-2xl shadow-black/30"
            id="mobile-navigation-menu"
          >
            {mobilePlanetSelector}
            <nav aria-label="Mobile app sections" className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {pages.map((page) => (
                <MobileTab
                  active={active === page.key || (active === "planet" && page.key === "galaxy") || (active === "alliance-inspect" && page.key === "alliance") || (active === "player-inspect" && page.key === "rankings")}
                  key={page.key}
                  icon={page.icon}
                  label={page.mobileLabel}
                  onClick={() => handleMobileNavigate(page.key)}
                />
              ))}
            </nav>
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
      className={`flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm transition ${
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

function MobileTab({
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
      className={`flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded border px-1 text-[11px] font-medium transition ${
        active
          ? "border-cyan-300/45 bg-cyan-300/10 text-cyan-200"
          : "border-white/10 bg-white/[0.04] text-slate-400 hover:bg-white/[0.075] hover:text-slate-200"
      }`}
      onClick={onClick}
      type="button"
      aria-current={active ? "page" : undefined}
    >
      <Icon aria-hidden="true" size={15} strokeWidth={1.9} />
      <span className="max-w-full truncate leading-none">{label}</span>
    </button>
  );
}
