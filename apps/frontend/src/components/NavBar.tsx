export type Page =
  | "overview"
  | "infrastructure"
  | "research"
  | "shipyard"
  | "galaxy"
  | "planet";

interface NavBarProps {
  active: Page;
  onNavigate: (page: Page) => void;
}

const pages: Array<{ key: Page; label: string; icon: string }> = [
  { key: "overview", label: "Overview", icon: "◈" },
  { key: "infrastructure", label: "Infrastructure", icon: "▣" },
  { key: "research", label: "Research", icon: "◇" },
  { key: "shipyard", label: "Shipyard", icon: "▸" },
  { key: "galaxy", label: "Galaxy", icon: "◉" },
];

export function NavBar({ active, onNavigate }: NavBarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden w-44 shrink-0 flex-col gap-1 border-r border-white/10 bg-[#0c111b]/80 p-3 backdrop-blur md:flex">
        <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
          Command
        </p>
        {pages.map((page) => (
          <NavItem
            active={active === page.key}
            icon={page.icon}
            key={page.key}
            label={page.label}
            onClick={() => onNavigate(page.key)}
          />
        ))}
      </nav>

      {/* Mobile top tabs */}
      <nav className="flex overflow-x-auto border-b border-white/10 bg-[#0c111b]/80 backdrop-blur md:hidden">
        {pages.map((page) => (
          <MobileTab
            active={active === page.key}
            key={page.key}
            label={page.label}
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
    >
      <span className="text-xs opacity-70">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function MobileTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`shrink-0 px-3 py-2.5 text-xs font-medium transition ${
        active
          ? "border-b-2 border-cyan-300 text-cyan-300"
          : "text-slate-400"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
