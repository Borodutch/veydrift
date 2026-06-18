import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { LucideIcon } from "lucide-preact";
import { ArrowLeftRight, Check, Crosshair, Factory, FlaskConical, Menu, Moon, Orbit, Pencil, Radar, Rocket, SatelliteDish, Shield, Trophy, Users, X } from "lucide-preact";

import {
  playerDisplayLabel,
  normalizePlayerDescription,
  playerDescriptionMaxLength,
  shortAddress,
  validatePlayerDescription,
  validatePlayerDisplayName,
  type PlayerProfile,
} from "../walletFlow";

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
  | "raid-target-finder"
  | "planet"
  | "battle-reports"
  | "player-inspect"
  | "alliance-inspect";

interface NavBarProps {
  active: Page;
  coordinates?: string | undefined;
  account?: string | undefined;
  onNavigate: (page: Page) => void;
  onUpdatePlayerProfile?: ((name: string, description: string | null) => void) | undefined;
  playerProfile?: PlayerProfile | undefined;
  playerProfileAction?: PlayerProfileActionState | undefined;
  canEditPlayerProfile?: boolean | undefined;
  planetPicker?: ComponentChildren;
}

type PlayerProfileActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

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
  { key: "raid-target-finder", label: "Raid Finder", mobileLabel: "Raids", icon: Crosshair },
];

export function NavBar({
  active,
  account,
  coordinates,
  onNavigate,
  onUpdatePlayerProfile,
  playerProfile,
  playerProfileAction = { status: "idle" },
  canEditPlayerProfile = false,
  planetPicker,
}: NavBarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [playerDraft, setPlayerDraft] = useState(playerProfile?.displayName ?? "");
  const [playerDescriptionDraft, setPlayerDescriptionDraft] = useState(playerProfile?.description ?? "");
  const [playerPanelOpen, setPlayerPanelOpen] = useState(false);
  const [playerValidation, setPlayerValidation] = useState<string | undefined>(undefined);
  const [copiedField, setCopiedField] = useState<{ key: string; nonce: number } | undefined>(undefined);
  const copiedResetTimer = useRef<number | undefined>(undefined);
  const playerLabel = playerDisplayLabel(playerProfile, account);
  const playerCopyValue = playerProfile?.displayName?.trim()
    || account
    || playerProfile?.fallbackName?.trim()
    || undefined;
  const playerProfileBusy = playerProfileAction.status === "pending";
  const playerStatusTone = playerProfileAction.status === "error"
    ? "text-amber-200"
    : playerProfileAction.status === "success"
      ? "text-emerald-200"
      : "text-slate-300";
  const playerStatusLabel = playerProfileAction.status === "idle" ? undefined : playerProfileAction.label;

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen]);

  useEffect(() => () => {
    if (copiedResetTimer.current !== undefined) {
      window.clearTimeout(copiedResetTimer.current);
    }
  }, []);

  const handleMobileNavigate = (page: Page) => {
    onNavigate(page);
    setMobileMenuOpen(false);
  };

  useEffect(() => {
    if (!playerPanelOpen) {
      setPlayerDraft(playerProfile?.displayName ?? "");
      setPlayerDescriptionDraft(playerProfile?.description ?? "");
      setPlayerValidation(undefined);
    }
  }, [playerPanelOpen, playerProfile?.description, playerProfile?.displayName]);

  useEffect(() => {
    if (playerProfileAction.status === "success") {
      setPlayerPanelOpen(false);
    }
  }, [playerProfileAction.status]);

  useEffect(() => {
    if (!playerPanelOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !playerProfileBusy) setPlayerPanelOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [playerPanelOpen, playerProfileBusy]);

  const handlePlayerSubmit = (event: Event) => {
    event.preventDefault();
    const nextName = playerDraft.trim().replace(/ {2,}/g, " ");
    const validation = validatePlayerDisplayName(nextName);
    if (validation) {
      setPlayerValidation(validation);
      return;
    }
    const nextDescription = normalizePlayerDescription(playerDescriptionDraft);
    const descriptionValidation = validatePlayerDescription(playerDescriptionDraft);
    if (descriptionValidation) {
      setPlayerValidation(descriptionValidation);
      return;
    }
    setPlayerValidation(undefined);
    onUpdatePlayerProfile?.(nextName, nextDescription);
  };

  const descriptionLength = Array.from(playerDescriptionDraft.replace(/\r\n?/g, "\n").trim()).length;
  const descriptionRemaining = Math.max(0, playerDescriptionMaxLength - descriptionLength);
  const descriptionCountTone = descriptionLength > playerDescriptionMaxLength ? "text-amber-200" : "text-slate-500";
  const handleCopyCommanderValue = (key: string, value: string) => {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard?.writeText) return;

    clipboard.writeText(value).then(() => {
      setCopiedField((current) => ({ key, nonce: (current?.nonce ?? 0) + 1 }));
      if (copiedResetTimer.current !== undefined) {
        window.clearTimeout(copiedResetTimer.current);
      }
      copiedResetTimer.current = window.setTimeout(() => {
        setCopiedField((current) => current?.key === key ? undefined : current);
      }, 900);
    }).catch(() => {
      // Clipboard access can be blocked outside a direct user gesture or by browser policy.
    });
  };

  const accountSummary = (className: string) => (
    <aside className={className} aria-label="Sidebar account summary">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase text-slate-500">
            Commander
          </p>
          <CopyableCommanderValue
            className="mt-1 w-full justify-start break-words text-left text-xs font-semibold leading-4 text-slate-100"
            copyKey="commander"
            copyValue={playerCopyValue}
            copiedField={copiedField}
            label="commander"
            onCopy={handleCopyCommanderValue}
            value={playerLabel}
          />
          {playerProfile?.displayName ? (
            <CopyableCommanderValue
              className="mt-0.5 w-full justify-start truncate text-left text-[10px] text-slate-500"
              copyKey="commander-fallback"
              copyValue={account ?? playerProfile.fallbackName}
              copiedField={copiedField}
              label="commander wallet"
              onCopy={handleCopyCommanderValue}
              value={playerProfile.fallbackName}
            />
          ) : null}
          {playerStatusLabel && !playerPanelOpen ? (
            <p className={`mt-1 break-words text-[10px] leading-4 ${playerStatusTone}`}>{playerStatusLabel}</p>
          ) : null}
        </div>
        {onUpdatePlayerProfile ? (
          <button
            aria-controls="commander-name-editor"
            aria-expanded={playerPanelOpen}
            aria-haspopup="dialog"
            aria-label="Edit player profile"
            className="inline-grid h-7 w-7 shrink-0 place-items-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
            disabled={playerProfileBusy}
            onClick={() => {
              setMobileMenuOpen(false);
              setPlayerPanelOpen(true);
              setPlayerDraft(playerProfile?.displayName ?? "");
              setPlayerDescriptionDraft(playerProfile?.description ?? "");
              setPlayerValidation(undefined);
            }}
            title="Edit player profile"
            type="button"
          >
            <Pencil aria-hidden="true" size={12} strokeWidth={2} />
          </button>
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/10 pt-2">
        <span className="text-[10px] font-semibold uppercase text-slate-500">
          Home
        </span>
        <CopyableCommanderValue
          className="max-w-[7.25rem] justify-end truncate text-right font-mono text-xs text-slate-100"
          copyKey="home"
          copyValue={coordinates}
          copiedField={copiedField}
          label="home coordinates"
          onCopy={handleCopyCommanderValue}
          value={coordinates ?? "--:--:--"}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-white/10 pt-1.5">
        <span className="text-[10px] font-semibold uppercase text-slate-500">
          Wallet
        </span>
        <CopyableCommanderValue
          className="max-w-[7.25rem] justify-end truncate text-right font-mono text-xs text-slate-300"
          copyKey="wallet"
          copyValue={account}
          copiedField={copiedField}
          label="wallet"
          onCopy={handleCopyCommanderValue}
          value={account ? shortAddress(account) : "Disconnected"}
        />
      </div>
    </aside>
  );

  const playerEditorDialog = onUpdatePlayerProfile && playerPanelOpen ? (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/60 p-3 backdrop-blur-sm sm:place-items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !playerProfileBusy) setPlayerPanelOpen(false);
      }}
    >
      <form
        aria-labelledby="commander-name-editor-title"
        aria-modal="true"
        className="grid max-h-[calc(100dvh-1.5rem)] w-full max-w-sm gap-3 overflow-y-auto rounded-lg border border-white/10 bg-[#08101d] p-3 shadow-2xl shadow-black/45"
        id="commander-name-editor"
        onSubmit={handlePlayerSubmit}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase text-slate-500">
              Commander
            </p>
            <h2 className="mt-1 break-words text-sm font-semibold leading-5 text-white" id="commander-name-editor-title">
              Edit profile
            </h2>
          </div>
          <button
            aria-label="Cancel player display name edit"
            className="inline-grid h-8 w-8 shrink-0 place-items-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
            disabled={playerProfileBusy}
            onClick={() => setPlayerPanelOpen(false)}
            title="Cancel"
            type="button"
          >
            <X aria-hidden="true" size={14} strokeWidth={2} />
          </button>
        </div>
        <label className="grid gap-1 text-xs font-medium text-slate-200">
          Display name
          <input
            className="h-9 rounded border border-white/10 bg-[#050b14]/95 px-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:text-slate-500"
            disabled={playerProfileBusy}
            maxLength={32}
            onInput={(event) => {
              setPlayerDraft(event.currentTarget.value);
              setPlayerValidation(undefined);
            }}
            placeholder="Enter display name"
            value={playerDraft}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-200">
          Description
          <textarea
            className="min-h-28 resize-y rounded border border-white/10 bg-[#050b14]/95 px-3 py-2 text-sm leading-5 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:text-slate-500"
            disabled={playerProfileBusy}
            maxLength={playerDescriptionMaxLength}
            onInput={(event) => {
              setPlayerDescriptionDraft(event.currentTarget.value);
              setPlayerValidation(undefined);
            }}
            placeholder="Public commander bio; plain URLs become links on your profile"
            value={playerDescriptionDraft}
          />
        </label>
        <p className={`text-right text-[10px] leading-3 ${descriptionCountTone}`}>
          {descriptionRemaining} / {playerDescriptionMaxLength}
        </p>
        <p className="text-[11px] leading-4 text-slate-300">
          Free wallet signature; no transaction or gas.
        </p>
        {(playerValidation || playerStatusLabel) && (
          <p className={`break-words text-[11px] leading-4 ${playerValidation ? "text-amber-200" : playerStatusTone}`}>
            {playerValidation ?? playerStatusLabel}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            aria-label="Cancel player display name edit"
            className="inline-grid h-8 w-8 place-items-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
            disabled={playerProfileBusy}
            onClick={() => setPlayerPanelOpen(false)}
            title="Cancel"
            type="button"
          >
            <X aria-hidden="true" size={14} strokeWidth={2} />
          </button>
          <button
            aria-label="Save player profile"
            className="inline-grid h-8 w-8 place-items-center rounded border border-cyan-300/40 bg-cyan-300/10 text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            disabled={!canEditPlayerProfile || playerProfileBusy}
            title={playerProfileBusy ? "Signing" : "Save profile"}
            type="submit"
          >
            <Check aria-hidden="true" size={14} strokeWidth={2} />
          </button>
        </div>
      </form>
    </div>
  ) : null;

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

          {accountSummary("sticky bottom-3 shrink-0 rounded-md border border-white/10 bg-[#07101d]/95 p-2 shadow-2xl shadow-black/30 backdrop-blur")}
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
            {accountSummary("rounded border border-white/10 bg-white/[0.03] p-2")}
            {planetPicker ? (
              <div
                className="rounded border border-white/10 bg-white/[0.03] p-2"
                // Close the menu once a planet is picked, matching nav-item behavior.
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("button")) setMobileMenuOpen(false);
                }}
              >
                <p className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Planets
                </p>
                {planetPicker}
              </div>
            ) : null}
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
      {playerEditorDialog}
    </>
  );
}

function CopyableCommanderValue({
  className,
  copiedField,
  copyKey,
  copyValue,
  label,
  onCopy,
  value,
}: {
  className: string;
  copiedField: { key: string; nonce: number } | undefined;
  copyKey: string;
  copyValue?: string | undefined;
  label: string;
  onCopy: (key: string, value: string) => void;
  value: string;
}) {
  const isCopied = copiedField?.key === copyKey;
  const valueClassName = className.includes("truncate")
    ? "inline-block max-w-full min-w-0 truncate"
    : "inline-block max-w-full min-w-0";
  const content = (
    <span className="relative inline-block max-w-full min-w-0 align-bottom">
      <span
        className={isCopied ? `${valueClassName} veydrift-copy-value-fade-up` : valueClassName}
        key={isCopied ? `${copyKey}-${copiedField.nonce}` : copyKey}
      >
        {value}
      </span>
    </span>
  );

  if (!copyValue) {
    return <span className={`inline-flex min-w-0 ${className}`}>{content}</span>;
  }

  return (
    <button
      aria-label={`Copy ${label}`}
      className={`group inline-flex min-w-0 cursor-copy rounded-sm transition hover:text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/55 ${className}`}
      data-copy-value={copyValue}
      onClick={() => onCopy(copyKey, copyValue)}
      title={`Copy ${label}`}
      type="button"
    >
      {content}
    </button>
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
