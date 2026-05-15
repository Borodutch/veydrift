import { shortAddress } from "../walletFlow";

export type Page =
  | "overview"
  | "infrastructure"
  | "research"
  | "shipyard"
  | "galaxy"
  | "planet";

interface NavBarProps {
  active: Page;
  coordinates?: string | undefined;
  account?: string | undefined;
  onNavigate: (page: Page) => void;
}

const pages: Array<{ key: Page; label: string; mobileLabel: string; icon: string }> = [
  { key: "overview", label: "Overview", mobileLabel: "Overview", icon: "◈" },
  { key: "infrastructure", label: "Infrastructure", mobileLabel: "Infra", icon: "▣" },
  { key: "research", label: "Research", mobileLabel: "Research", icon: "◇" },
  { key: "shipyard", label: "Shipyard", mobileLabel: "Shipyard", icon: "▸" },
  { key: "galaxy", label: "Galaxy", mobileLabel: "Galaxy", icon: "◉" },
];

export function NavBar({ active, account, coordinates, onNavigate }: NavBarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden w-52 shrink-0 flex-col border-r border-white/10 bg-[#0a0f1a] md:flex">
        <div className="flex min-h-[calc(100dvh-52px)] flex-col gap-4 bg-[linear-gradient(180deg,rgba(20,29,45,0.82),rgba(8,12,23,0.98))] p-3 shadow-[inset_-1px_0_rgba(255,255,255,0.04)]">
          <div className="border-b border-white/10 px-2 pb-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">
              Command
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
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

      {/* Mobile top tabs */}
      <nav className="grid grid-cols-5 border-b border-white/10 bg-[#0c111b]/95 backdrop-blur md:hidden">
        {pages.map((page) => (
          <MobileTab
            active={active === page.key || (active === "planet" && page.key === "galaxy")}
            key={page.key}
            icon={page.icon}
            label={page.mobileLabel}
            onClick={() => onNavigate(page.key)}
          />
        ))}
      </nav>
    </>
  );
}

function NavItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: string;
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
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded border border-white/10 bg-black/20 text-xs opacity-80">
        {icon}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function MobileTab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition ${
        active
          ? "border-b-2 border-cyan-300 bg-cyan-300/5 text-cyan-300"
          : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
      }`}
      onClick={onClick}
      type="button"
      aria-current={active ? "page" : undefined}
    >
      <span className="text-[10px] leading-none opacity-80">{icon}</span>
      <span className="max-w-full truncate leading-none">{label}</span>
    </button>
  );
}
