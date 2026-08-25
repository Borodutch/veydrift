import type { ComponentChildren, JSX } from "preact";
import { flushSync } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import type { LucideIcon } from "lucide-preact";
import { ArrowLeftRight, Check, ChevronDown, ChevronUp, Crosshair, Factory, FlaskConical, History, Mail, Menu, Moon, Orbit, Pencil, Radar, Rocket, SatelliteDish, Shield, Trophy, Users, X } from "lucide-preact";

import {
  playerDisplayLabel,
  normalizePlayerDescription,
  playerDescriptionMaxLength,
  shortAddress,
  validatePlayerDescription,
  validatePlayerDisplayName,
  type PlayerProfile,
} from "../walletFlow";
import { buildInspectPath } from "../inspectRoutes";

export type Page =
  | "overview"
  | "infrastructure"
  | "defenses"
  | "research"
  | "shipyard"
  | "mission-control"
  | "moon"
  | "alliance"
  | "alliance-invites"
  | "rift"
  | "rankings"
  | "galaxy"
  | "raid-target-finder"
  | "planet"
  | "moon-inspect"
  | "battle-reports"
  | "player-inspect"
  | "alliance-inspect";

interface NavBarProps {
  active: Page;
  coordinates?: string | undefined;
  account?: string | undefined;
  onNavigate: (page: Page) => void;
  onConnectWallet?: (() => void) | undefined;
  onOpenActivity?: (() => void) | undefined;
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

export const commanderJoinCta = {
  action: "Connect wallet",
  label: "Join Veydrift",
} as const;

export const commanderSummaryInitiallyExpanded = false;

const commanderCollapsedIdentityGeometry = {
  lineHeightPx: 16,
  opticalOffsetYPx: 2,
  rowHeightPx: 28,
} as const;

export function shouldShowCommanderJoinCta(account?: string | undefined, onConnectWallet?: (() => void) | undefined): boolean {
  return !account && Boolean(onConnectWallet);
}

export function commanderIdentityLabel(
  playerProfile?: PlayerProfile | undefined,
  account?: string | undefined,
): string {
  return playerDisplayLabel(playerProfile, account);
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
  { key: "raid-target-finder", label: "Raid Finder", mobileLabel: "Raids", icon: Crosshair },
  { key: "alliance-invites", label: "Earn $10", mobileLabel: "Earn $10", icon: Mail },
];

export function NavBar({
  active,
  account,
  coordinates,
  onConnectWallet,
  onNavigate,
  onOpenActivity,
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
  const [commanderSummaryExpanded, setCommanderSummaryExpanded] = useState(commanderSummaryInitiallyExpanded);
  const [playerValidation, setPlayerValidation] = useState<string | undefined>(undefined);
  const [copiedField, setCopiedField] = useState<{ key: string; nonce: number } | undefined>(undefined);
  const mobileNavigationDetails = useRef<HTMLDetailsElement | null>(null);
  const copiedResetTimer = useRef<number | undefined>(undefined);
  const playerLabel = commanderIdentityLabel(playerProfile, account);
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

  const closeMobileMenu = () => {
    if (mobileNavigationDetails.current) {
      mobileNavigationDetails.current.open = false;
    }
    setMobileMenuOpen(false);
  };

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobileMenu();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen]);

  useEffect(() => () => {
    if (copiedResetTimer.current !== undefined) {
      window.clearTimeout(copiedResetTimer.current);
    }
  }, []);

  const closeMobileMenuAfterNavigation = () => {
    const view = mobileNavigationDetails.current?.ownerDocument.defaultView;
    if (typeof view?.requestAnimationFrame === "function") {
      view.requestAnimationFrame(closeMobileMenu);
      return;
    }
    if (typeof view?.setTimeout === "function") {
      view.setTimeout(closeMobileMenu, 0);
      return;
    }
    closeMobileMenu();
  };

  const handleMobileNavigate = (page: Page) => {
    onNavigate(page);
    // Keep the tapped anchor mounted through the browser's trailing click.
    // Pointer release has already committed the page, so closing synchronously
    // can turn that same gesture into a click on a newly rendered raid target.
    closeMobileMenuAfterNavigation();
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

  const accountSummary = (className: string, detailsId: string) => {
    if (shouldShowCommanderJoinCta(account, onConnectWallet)) {
      return (
        <aside className={className} aria-label="Sidebar account summary">
          <p className="text-[10px] font-semibold uppercase text-slate-500">
            Commander
          </p>
          <p className="mt-1 text-xs font-semibold leading-4 text-white">
            {commanderJoinCta.label}
          </p>
          <button
            className="mt-2 inline-flex h-8 w-full items-center justify-center rounded border border-cyan-300/45 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
            onClick={() => {
              closeMobileMenu();
              onConnectWallet?.();
            }}
            type="button"
          >
            {commanderJoinCta.action}
          </button>
        </aside>
      );
    }

    return (
      <CommanderAccountSummary
        account={account}
        className={className}
        coordinates={coordinates}
        copiedField={copiedField}
        detailsId={detailsId}
        expanded={commanderSummaryExpanded}
        onCopy={handleCopyCommanderValue}
        onEdit={onUpdatePlayerProfile
          ? () => {
            closeMobileMenu();
            setPlayerPanelOpen(true);
            setPlayerDraft(playerProfile?.displayName ?? "");
            setPlayerDescriptionDraft(playerProfile?.description ?? "");
            setPlayerValidation(undefined);
          }
          : undefined}
        onOpenActivity={account && onOpenActivity
          ? () => {
            setMobileMenuOpen(false);
            onOpenActivity();
          }
          : undefined}
        onToggle={() => setCommanderSummaryExpanded((expanded) => !expanded)}
        playerCopyValue={playerCopyValue}
        playerLabel={playerLabel}
        playerPanelOpen={playerPanelOpen}
        playerProfile={playerProfile}
        playerProfileBusy={playerProfileBusy}
        playerStatusLabel={playerStatusLabel}
        playerStatusTone={playerStatusTone}
      />
    );
  };

  const playerEditorDialog = onUpdatePlayerProfile && playerPanelOpen ? (
    <div
      className="modal-backdrop-enter fixed inset-0 z-50 grid place-items-end bg-black/60 p-3 backdrop-blur-sm sm:place-items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !playerProfileBusy) setPlayerPanelOpen(false);
      }}
    >
      <form
        aria-labelledby="commander-name-editor-title"
        aria-modal="true"
        className="modal-panel-enter grid max-h-[calc(100dvh-1.5rem)] w-full max-w-sm gap-3 overflow-y-auto rounded-lg border border-white/10 bg-[#08101d] p-3 shadow-2xl shadow-black/45"
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
      <nav className="hidden h-[calc(100dvh-var(--topbar-h,2.75rem))] w-52 shrink-0 flex-col border-r border-white/10 bg-[#0a0f1a] md:sticky md:top-[var(--topbar-h,2.75rem)] md:flex">
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
                href={buildInspectPath({ kind: "page", page: page.key })}
                icon={page.icon}
                key={page.key}
                label={page.label}
                onClick={() => onNavigate(page.key)}
              />
            ))}
          </div>

          {accountSummary(
            "sticky bottom-3 shrink-0 rounded-md border border-white/10 bg-[#07101d]/95 p-2 shadow-2xl shadow-black/30 backdrop-blur",
            "desktop-commander-account-details",
          )}
        </div>
      </nav>

      {/* Mobile navigation */}
      {mobileMenuOpen && (
        <button
          aria-hidden="true"
          className="fixed inset-0 z-10 cursor-default bg-black/40 md:hidden"
          onClick={closeMobileMenu}
          tabIndex={-1}
          type="button"
        />
      )}
      <details
        className="sticky top-[var(--topbar-h,2.75rem)] z-20 w-full max-w-full overflow-hidden border-b border-white/10 bg-[#0c111b]/95 backdrop-blur md:hidden"
        onToggle={(event) => setMobileMenuOpen(event.currentTarget.open)}
        ref={mobileNavigationDetails}
      >
        <summary
          aria-controls="mobile-navigation-menu"
          aria-expanded={mobileMenuOpen}
          aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
          className="group flex h-12 min-w-0 cursor-pointer list-none items-center justify-between gap-3 px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300/60 [&::-webkit-details-marker]:hidden"
          role="button"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">Veydrift</p>
            <p className="font-mono text-[11px] leading-none text-slate-500">
              {coordinates ?? "--:--:--"}
            </p>
          </div>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded border border-white/10 bg-white/[0.06] text-slate-100 transition group-hover:bg-white/10">
            {mobileMenuOpen ? <X aria-hidden="true" size={18} strokeWidth={2} /> : <Menu aria-hidden="true" size={18} strokeWidth={2} />}
          </span>
        </summary>

        <div
          className="grid min-w-0 max-w-full gap-3 overflow-hidden border-t border-white/10 bg-[#08101d]/98 p-3 shadow-2xl shadow-black/30"
          id="mobile-navigation-menu"
        >
          {accountSummary(
            "rounded border border-white/10 bg-white/[0.03] p-2",
            "mobile-commander-account-details",
          )}
          {planetPicker ? (
            <div
              className="min-w-0 max-w-full overflow-hidden rounded border border-white/10 bg-white/[0.03] p-2"
              // Close the menu once a planet is picked, matching nav-item behavior.
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("button")) closeMobileMenu();
              }}
            >
              <p className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Planets
              </p>
              {planetPicker}
            </div>
          ) : null}
          <nav aria-label="Mobile app sections" className="grid min-w-0 grid-cols-[repeat(3,minmax(0,1fr))] gap-1.5 sm:grid-cols-[repeat(4,minmax(0,1fr))]">
            {pages.map((page) => (
              <MobileTab
                active={active === page.key || (active === "planet" && page.key === "galaxy") || (active === "alliance-inspect" && page.key === "alliance") || (active === "player-inspect" && page.key === "rankings")}
                href={buildInspectPath({ kind: "page", page: page.key })}
                key={page.key}
                icon={page.icon}
                label={page.label}
                onClick={() => handleMobileNavigate(page.key)}
              />
            ))}
          </nav>
        </div>
      </details>
      {playerEditorDialog}
    </>
  );
}

export function CommanderAccountSummary({
  account,
  className,
  coordinates,
  copiedField,
  detailsId,
  expanded,
  onCopy,
  onEdit,
  onOpenActivity,
  onToggle,
  playerCopyValue,
  playerLabel,
  playerPanelOpen,
  playerProfile,
  playerProfileBusy,
  playerStatusLabel,
  playerStatusTone,
}: {
  account?: string | undefined;
  className: string;
  coordinates?: string | undefined;
  copiedField: { key: string; nonce: number } | undefined;
  detailsId: string;
  expanded: boolean;
  onCopy: (key: string, value: string) => void;
  onEdit?: (() => void) | undefined;
  onOpenActivity?: (() => void) | undefined;
  onToggle: () => void;
  playerCopyValue?: string | undefined;
  playerLabel: string;
  playerPanelOpen: boolean;
  playerProfile?: PlayerProfile | undefined;
  playerProfileBusy: boolean;
  playerStatusLabel?: string | undefined;
  playerStatusTone: string;
}) {
  const headerStyle = {
    minHeight: `${commanderCollapsedIdentityGeometry.rowHeightPx}px`,
  };
  const identityStyle = {
    height: expanded ? undefined : `${commanderCollapsedIdentityGeometry.rowHeightPx}px`,
    lineHeight: `${commanderCollapsedIdentityGeometry.lineHeightPx}px`,
  };
  const identityContentStyle = expanded
    ? undefined
    : { transform: `translateY(${commanderCollapsedIdentityGeometry.opticalOffsetYPx}px)` };
  const disclosureStyle = {
    height: `${commanderCollapsedIdentityGeometry.rowHeightPx}px`,
    width: `${commanderCollapsedIdentityGeometry.rowHeightPx}px`,
  };

  return (
    <aside className={className} aria-label="Sidebar account summary">
      <div
        className={`flex min-w-0 justify-between gap-2 ${expanded ? "items-start" : "items-center"}`}
        style={headerStyle}
      >
        <div className="min-w-0 flex-1">
          {expanded ? (
            <p className="text-[10px] font-semibold uppercase text-slate-500">
              Commander
            </p>
          ) : null}
          <CopyableCommanderValue
            className={`${expanded ? "mt-1 break-words" : "items-center truncate"} w-full justify-start text-left text-xs font-semibold text-slate-100`}
            contentStyle={identityContentStyle}
            copyKey="commander"
            copyValue={playerCopyValue}
            copiedField={copiedField}
            label="commander"
            onCopy={onCopy}
            style={identityStyle}
            value={playerLabel}
          />
          {expanded && playerProfile?.displayName ? (
            <CopyableCommanderValue
              className="mt-0.5 w-full justify-start truncate text-left text-[10px] text-slate-500"
              copyKey="commander-fallback"
              copyValue={account ?? playerProfile.fallbackName}
              copiedField={copiedField}
              label="commander wallet"
              onCopy={onCopy}
              value={playerProfile.fallbackName}
            />
          ) : null}
          {expanded && playerStatusLabel && !playerPanelOpen ? (
            <p className={`mt-1 break-words text-[10px] leading-4 ${playerStatusTone}`}>{playerStatusLabel}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {expanded && onEdit ? (
            <button
              aria-controls="commander-name-editor"
              aria-expanded={playerPanelOpen}
              aria-haspopup="dialog"
              aria-label="Edit player profile"
              className="inline-grid h-7 w-7 shrink-0 place-items-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
              disabled={playerProfileBusy}
              onClick={onEdit}
              title="Edit player profile"
              type="button"
            >
              <Pencil aria-hidden="true" size={12} strokeWidth={2} />
            </button>
          ) : null}
          <button
            aria-controls={detailsId}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse Commander profile" : "Expand Commander profile"}
            className="inline-grid shrink-0 place-items-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
            onClick={onToggle}
            style={disclosureStyle}
            title={expanded ? "Collapse Commander profile" : "Expand Commander profile"}
            type="button"
          >
            {expanded
              ? <ChevronDown aria-hidden="true" size={13} strokeWidth={2} />
              : <ChevronUp aria-hidden="true" size={13} strokeWidth={2} />}
          </button>
        </div>
      </div>
      {expanded ? (
        <div id={detailsId}>
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
              onCopy={onCopy}
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
              onCopy={onCopy}
              value={account ? shortAddress(account) : "Disconnected"}
            />
          </div>
          {onOpenActivity ? (
            <button
              aria-haspopup="dialog"
              className="mt-1.5 flex h-8 w-full items-center justify-between gap-2 border-t border-white/10 pt-1.5 text-left text-[10px] font-semibold uppercase text-slate-500 transition hover:text-cyan-200 focus:outline-none focus-visible:text-cyan-200"
              onClick={onOpenActivity}
              type="button"
            >
              Activity
              <History aria-hidden="true" className="text-slate-300" size={13} strokeWidth={2} />
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function CopyableCommanderValue({
  className,
  contentStyle,
  copiedField,
  copyKey,
  copyValue,
  label,
  onCopy,
  style,
  value,
}: {
  className: string;
  contentStyle?: JSX.CSSProperties | undefined;
  copiedField: { key: string; nonce: number } | undefined;
  copyKey: string;
  copyValue?: string | undefined;
  label: string;
  onCopy: (key: string, value: string) => void;
  style?: JSX.CSSProperties | undefined;
  value: string;
}) {
  const isCopied = copiedField?.key === copyKey;
  const valueClassName = className.includes("truncate")
    ? "inline-block max-w-full min-w-0 truncate"
    : "inline-block max-w-full min-w-0";
  const content = (
    <span className="relative inline-block max-w-full min-w-0 align-bottom" style={contentStyle}>
      <span className={valueClassName}>{value}</span>
      {isCopied ? (
        <span
          aria-hidden="true"
          className={`${valueClassName} pointer-events-none absolute inset-x-0 top-0 veydrift-copy-value-fade-up`}
          key={`${copyKey}-${copiedField.nonce}`}
        >
          {value}
        </span>
      ) : null}
    </span>
  );

  if (!copyValue) {
    return <span className={`inline-flex min-w-0 ${className}`} style={style}>{content}</span>;
  }

  return (
    <button
      aria-label={`Copy ${label}`}
      className={`group inline-flex min-w-0 cursor-copy rounded-sm transition hover:text-cyan-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55 ${className}`}
      data-copy-value={copyValue}
      onClick={() => onCopy(copyKey, copyValue)}
      style={style}
      title={`Copy ${label}`}
      type="button"
    >
      {content}
    </button>
  );
}

function handleSectionLinkClick(
  event: JSX.TargetedMouseEvent<HTMLAnchorElement>,
  onClick: () => void,
): void {
  if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

  const link = event.currentTarget;
  if (sectionLinkSuppressedClicks.has(link)) {
    sectionLinkSuppressedClicks.delete(link);
    event.preventDefault();
    return;
  }
  const view = link.ownerDocument.defaultView;
  const targetUrl = link.href;

  // A preceding primary pointerup may already have committed the route. Keep
  // the following click as the native/keyboard fallback without running the
  // application transition twice.
  if (view?.location.href === targetUrl) {
    event.preventDefault();
    return;
  }

  // Commit the selected page before the handler returns. pushState updates the
  // URL synchronously, while Preact normally defers the corresponding render;
  // that briefly leaves the previous page visible at the new URL and can be
  // observed by browser automation (or a screenshot in the same frame). Keep
  // the canonical URL and rendered page atomic for section navigation.
  //
  // Do not delegate failure recovery to the browser's post-handler default
  // action. A hydrated callback can still return without changing routes, and
  // production has intermittently dropped that native follow-up. Explicitly
  // assign the canonical URL in that case so one activation always navigates.
  try {
    flushSync(onClick);
  } catch (error) {
    if (!view) throw error;
    if (view.location.href !== targetUrl) view.location.assign(targetUrl);
    event.preventDefault();
    throw error;
  }

  if (!view) return;
  if (view.location.href !== targetUrl) view.location.assign(targetUrl);
  event.preventDefault();
}

interface SectionLinkPointerActivation {
  moved: boolean;
  pointerId: number;
  startX: number;
  startY: number;
}

const sectionLinkPointerActivations = new WeakMap<HTMLAnchorElement, SectionLinkPointerActivation>();
const sectionLinkSuppressedClicks = new WeakSet<HTMLAnchorElement>();
const sectionLinkPointerMoveTolerancePx = 12;

function sectionLinkPointerMoved(activation: SectionLinkPointerActivation, clientX: number, clientY: number): boolean {
  const deltaX = clientX - activation.startX;
  const deltaY = clientY - activation.startY;
  return (deltaX * deltaX) + (deltaY * deltaY) > sectionLinkPointerMoveTolerancePx ** 2;
}

function handleSectionLinkPointerDown(event: JSX.TargetedPointerEvent<HTMLAnchorElement>): void {
  const link = event.currentTarget;
  sectionLinkPointerActivations.delete(link);
  if (
    event.button !== 0
    || event.isPrimary === false
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
  ) return;

  sectionLinkPointerActivations.set(link, {
    moved: false,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
  });
  try {
    link.setPointerCapture?.(event.pointerId);
  } catch {
    // The activation checks still work when capture is unavailable or lost.
  }
}

function handleSectionLinkPointerMove(event: JSX.TargetedPointerEvent<HTMLAnchorElement>): void {
  const activation = sectionLinkPointerActivations.get(event.currentTarget);
  if (!activation || activation.pointerId !== event.pointerId || activation.moved) return;
  if (sectionLinkPointerMoved(activation, event.clientX, event.clientY)) activation.moved = true;
}

function clearSectionLinkPointerActivation(event: JSX.TargetedPointerEvent<HTMLAnchorElement>): void {
  const activation = sectionLinkPointerActivations.get(event.currentTarget);
  if (activation?.pointerId === event.pointerId) sectionLinkPointerActivations.delete(event.currentTarget);
}

function suppressSectionLinkFollowupClick(link: HTMLAnchorElement): void {
  sectionLinkSuppressedClicks.add(link);
  const clear = () => sectionLinkSuppressedClicks.delete(link);
  const view = link.ownerDocument.defaultView;
  if (typeof view?.setTimeout === "function") {
    view.setTimeout(clear, 0);
  } else {
    globalThis.setTimeout(clear, 0);
  }
}

function handleSectionLinkPointerUp(
  event: JSX.TargetedPointerEvent<HTMLAnchorElement>,
  onClick: () => void,
): void {
  const link = event.currentTarget;
  const activation = sectionLinkPointerActivations.get(link);
  sectionLinkPointerActivations.delete(link);
  if (
    !activation
    || activation.pointerId !== event.pointerId
    || event.button !== 0
    || event.isPrimary === false
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
  ) return;

  const releaseTarget = link.ownerDocument.elementFromPoint?.(event.clientX, event.clientY);
  const releasedOutsideLink = Boolean(releaseTarget && releaseTarget !== link && !link.contains(releaseTarget));
  if (
    activation.moved
    || sectionLinkPointerMoved(activation, event.clientX, event.clientY)
    || releasedOutsideLink
  ) {
    suppressSectionLinkFollowupClick(link);
    return;
  }

  const view = link.ownerDocument.defaultView;
  const targetUrl = link.href;
  if (!view || view.location.href === targetUrl) return;

  // Committing this callback can unmount a mobile section link immediately
  // (the menu closes as its destination renders). Consume the browser's
  // trailing click *before* that happens: Android otherwise retargets that
  // click at whatever just appeared under the finger, such as the first Raid
  // Finder target, and opens it without a second intentional tap.
  event.preventDefault();
  suppressSectionLinkFollowupClick(link);

  // Commit on pointer release, before the browser's later click phase. Chrome
  // can lose that click when another first-gesture listener fails or consumes
  // it; in that state the exact anchor receives the trusted pointer sequence,
  // but neither the SPA callback nor the anchor default ever runs. Pointerup
  // preserves release-to-activate semantics while making the canonical route
  // independent from that fragile follow-up event. Keyboard and modified-click
  // behavior still use the click/native-anchor path below.
  try {
    flushSync(onClick);
  } catch (error) {
    if (view.location.href !== targetUrl) view.location.assign(targetUrl);
    throw error;
  }

  if (view.location.href !== targetUrl) view.location.assign(targetUrl);
}

export function NavItem({
  active,
  href,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <a
      className={`flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm transition ${
        active
          ? "bg-white/10 font-medium text-white"
          : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
      }`}
      href={href}
      onClick={(event) => handleSectionLinkClick(event, onClick)}
      onLostPointerCapture={clearSectionLinkPointerActivation}
      onPointerCancel={clearSectionLinkPointerActivation}
      onPointerDown={handleSectionLinkPointerDown}
      onPointerMove={handleSectionLinkPointerMove}
      onPointerUp={(event) => handleSectionLinkPointerUp(event, onClick)}
      aria-current={active ? "page" : undefined}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded border border-white/10 bg-black/20 text-slate-300 opacity-90">
        <Icon aria-hidden="true" size={15} strokeWidth={1.9} />
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </a>
  );
}

export function MobileTab({
  active,
  href,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <a
      className={`flex h-12 min-w-0 max-w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded border px-1 text-[11px] font-medium transition ${
        active
          ? "border-cyan-300/45 bg-cyan-300/10 text-cyan-200"
          : "border-white/10 bg-white/[0.04] text-slate-400 hover:bg-white/[0.075] hover:text-slate-200"
      }`}
      href={href}
      onClick={(event) => handleSectionLinkClick(event, onClick)}
      onLostPointerCapture={clearSectionLinkPointerActivation}
      onPointerCancel={clearSectionLinkPointerActivation}
      onPointerDown={handleSectionLinkPointerDown}
      onPointerMove={handleSectionLinkPointerMove}
      onPointerUp={(event) => handleSectionLinkPointerUp(event, onClick)}
      aria-current={active ? "page" : undefined}
    >
      <Icon aria-hidden="true" size={15} strokeWidth={1.9} />
      <span className="max-w-full truncate leading-none">{label}</span>
    </a>
  );
}
