import type { ComponentChildren, JSX } from "preact";
import { createPortal, flushSync } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import type { LucideIcon } from "lucide-preact";
import { ArrowLeftRight, ChevronDown, ChevronsUpDown, Crosshair, Factory, FlaskConical, History, Mail, Menu, Moon, Orbit, PanelLeftClose, PanelLeftOpen, Pencil, Radar, Rocket, SatelliteDish, Shield, Trophy, UserRound, Users, X } from "lucide-preact";

import {
  playerDisplayLabel,
  normalizePlayerDescription,
  playerDescriptionMaxLength,
  shortAddress,
  validatePlayerDescription,
  validatePlayerDisplayName,
  type PlayerProfile,
  type WalletDelegationState,
} from "../walletFlow";
import { buildInspectPath } from "../inspectRoutes";
import { Modal } from "./Modal";
import { ModalHeader } from "./ModalHeader";
import { readSidebarCollapsed, writeSidebarCollapsed } from "../sidebarPreference";

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
  onRevokeDelegate?: (() => void) | undefined;
  onSetDelegate?: ((delegate: string) => void) | undefined;
  onRefreshDelegation?: (() => void) | undefined;
  onUpdatePlayerProfile?: ((name: string, description: string | null) => void) | undefined;
  playerProfile?: PlayerProfile | undefined;
  playerProfileAction?: PlayerProfileActionState | undefined;
  delegation?: WalletDelegationState | undefined;
  delegationAction?: PlayerProfileActionState | undefined;
  signerAccount?: string | undefined;
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

export function shouldShowCommanderJoinCta(account?: string | undefined, onConnectWallet?: (() => void) | undefined): boolean {
  return !account && Boolean(onConnectWallet);
}

export function commanderIdentityLabel(
  playerProfile?: PlayerProfile | undefined,
  account?: string | undefined,
): string {
  return playerDisplayLabel(playerProfile, account);
}

// Icons carry their own color so hover on the row never changes them; the current page uses cyan.
const sidebarIconClassName = "grid h-5 w-5 shrink-0 place-items-center text-slate-400";

const pages: Array<{ key: Page; label: string; mobileLabel: string; icon: LucideIcon }> = [
  { key: "overview", label: "Empire", mobileLabel: "Empire", icon: Radar },
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

// Mobile menu order: planet screens, then fleet, then the wider universe.
const mobilePageOrder = ([
  "overview", "infrastructure", "defenses", "research", "shipyard", "moon",
  "mission-control", "galaxy", "raid-target-finder",
  "rift", "alliance", "rankings", "alliance-invites",
] as const).map((key) => pages.find((page) => page.key === key)!);

export function NavBar({
  active,
  account,
  coordinates,
  onConnectWallet,
  onNavigate,
  onOpenActivity,
  onRevokeDelegate,
  onSetDelegate,
  onRefreshDelegation,
  onUpdatePlayerProfile,
  playerProfile,
  playerProfileAction = { status: "idle" },
  delegation,
  delegationAction = { status: "idle" },
  signerAccount,
  canEditPlayerProfile = false,
  planetPicker,
}: NavBarProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const compactAccount = useRef<HTMLDetailsElement | null>(null);
  const [playerDraft, setPlayerDraft] = useState(playerProfile?.displayName ?? "");
  const [playerDescriptionDraft, setPlayerDescriptionDraft] = useState(playerProfile?.description ?? "");
  const [delegateDraft, setDelegateDraft] = useState(delegation?.delegate ?? "");
  const [playerPanelOpen, setPlayerPanelOpen] = useState(false);
  const [mobileCommanderOpen, setMobileCommanderOpen] = useState(false);
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
  const delegationBusy = delegationAction.status === "pending";
  const playerStatusTone = playerProfileAction.status === "error"
    ? "text-amber-200"
    : playerProfileAction.status === "success"
      ? "text-emerald-200"
      : "text-slate-300";
  const playerStatusLabel = playerProfileAction.status === "idle" ? undefined : playerProfileAction.label;
  const delegationStatusTone = delegationAction.status === "error"
    ? "text-amber-200"
    : delegationAction.status === "success"
      ? "text-emerald-200"
      : "text-slate-300";
  const delegationStatusLabel = delegationAction.status === "idle" ? undefined : delegationAction.label;
  const canSetDelegate = Boolean(
    signerAccount
      && account
      && signerAccount.toLowerCase() === account.toLowerCase()
      && !delegation?.actingAsDelegate
      && onSetDelegate,
  );

  const closeMobileMenu = () => {
    if (mobileNavigationDetails.current) {
      mobileNavigationDetails.current.open = false;
    }
    setMobileMenuOpen(false);
    if (compactAccount.current) compactAccount.current.open = false;
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
    setDelegateDraft(delegation?.delegate ?? "");
  }, [delegation?.delegate, signerAccount]);

  useEffect(() => {
    if (playerProfileAction.status === "success") {
      setPlayerPanelOpen(false);
    }
  }, [playerProfileAction.status]);

  const handlePlayerSubmit = (event: Event) => {
    event.preventDefault();
    if (!canEditPlayerProfile || playerProfileBusy || delegationBusy) return;
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

  const accountSummary = (className: string, layout: "list" | "card" | "body" = "list") => {
    if (shouldShowCommanderJoinCta(account, onConnectWallet)) {
      return (
        <aside className={className} aria-label="Sidebar account summary">
          <p className="text-sm font-semibold text-white">
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
        layout={layout}
        onCopy={handleCopyCommanderValue}
        onEdit={onUpdatePlayerProfile
          ? () => {
            closeMobileMenu();
            setPlayerPanelOpen(true);
            setPlayerDraft(playerProfile?.displayName ?? "");
            setPlayerDescriptionDraft(playerProfile?.description ?? "");
            setDelegateDraft(delegation?.delegate ?? "");
            setPlayerValidation(undefined);
          }
          : undefined}
        onOpenActivity={account && onOpenActivity
          ? () => {
            setMobileMenuOpen(false);
            if (compactAccount.current) compactAccount.current.open = false;
            onOpenActivity();
          }
          : undefined}
        playerCopyValue={playerCopyValue}
        playerLabel={playerLabel}
        playerPanelOpen={playerPanelOpen}
        playerProfileBusy={playerProfileBusy}
        playerStatusLabel={playerStatusLabel}
        playerStatusTone={playerStatusTone}
      />
    );
  };

  const playerEditorDialog = onUpdatePlayerProfile && playerPanelOpen ? (
    <Modal
      dismissible={!playerProfileBusy && !delegationBusy}
      id="commander-name-editor"
      labelledBy="commander-name-editor-title"
      onClose={() => setPlayerPanelOpen(false)}
      panelClassName="grid max-w-sm gap-4 p-4"
    >
      <ModalHeader
        closeDisabled={playerProfileBusy || delegationBusy}
        closeLabel="Cancel player display name edit"
        onClose={() => setPlayerPanelOpen(false)}
        title="Edit profile"
        titleId="commander-name-editor-title"
      />
      <form aria-labelledby="profile-details-title" className="grid gap-3" onSubmit={handlePlayerSubmit}>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300/70" id="profile-details-title">Profile details</h3>
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
        {(playerValidation || playerStatusLabel) && (
          <p role="status" className={`break-words text-[11px] leading-4 ${playerValidation ? "text-amber-200" : playerStatusTone}`}>
            {playerValidation ?? playerStatusLabel}
          </p>
        )}
        <button
          aria-label="Save player profile"
          className="h-9 justify-self-end rounded border border-cyan-300/40 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canEditPlayerProfile || playerProfileBusy || delegationBusy}
          type="submit"
        >
          {playerProfileBusy ? "Signing…" : "Save profile"}
        </button>
      </form>
      <section className="grid gap-2 border-t border-cyan-300/10 pt-4" aria-label="Wallet delegation">
        <div>
          <h3 className="text-xs font-semibold text-cyan-200/80">Wallet delegate</h3>
          {delegation?.actingAsDelegate && signerAccount && account ? (
            <p className="mt-1 text-[11px] leading-4 text-slate-300">
              Connected as {shortAddress(signerAccount)} and acting for {shortAddress(account)}.
            </p>
          ) : (
            <p className="mt-1 text-[11px] leading-4 text-slate-300">
              {delegation?.delegate
                ? `${shortAddress(delegation.delegate)} can perform gameplay actions for this wallet.`
                : "No delegate is currently set."}
            </p>
          )}
        </div>
        <p className="text-[11px] leading-4 text-slate-300">
          Allow another wallet to perform gameplay actions on your behalf. Use with caution—useful for AI agents. This does not transfer wallet ownership. Only the main wallet can set or replace a delegate.
        </p>
        <p className="text-[11px] leading-4 text-slate-300">
          Setting, replacing, or revoking a delegate is an on-chain transaction with network gas fees.
        </p>
        {canSetDelegate ? (
          <label className="grid gap-1 text-xs font-medium text-slate-200">
            Delegate address
            <input
              className="h-9 rounded border border-white/10 bg-[#050b14]/95 px-3 font-mono text-xs text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:text-slate-500"
              disabled={delegationBusy || playerProfileBusy}
              onInput={(event) => setDelegateDraft(event.currentTarget.value)}
              placeholder="0x…"
              value={delegateDraft}
            />
          </label>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          {delegation?.delegate && onRevokeDelegate ? (
            <button
              className="h-8 rounded border border-rose-300/30 bg-rose-300/10 px-3 text-xs font-semibold text-rose-100 transition hover:bg-rose-300/20 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={delegationBusy || playerProfileBusy}
              onClick={onRevokeDelegate}
              type="button"
            >
              {delegation?.actingAsDelegate ? "Revoke my access" : "Revoke delegate"}
            </button>
          ) : null}
          {canSetDelegate ? (
            <button
              className="h-8 rounded border border-cyan-300/40 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={delegationBusy || playerProfileBusy || !delegateDraft.trim()}
              onClick={() => onSetDelegate?.(delegateDraft)}
              type="button"
            >
              {delegation?.delegate ? "Replace delegate" : "Set delegate"}
            </button>
          ) : null}
        </div>
        {delegationStatusLabel ? (
          <p role="status" className={`break-words text-[11px] leading-4 ${delegationStatusTone}`}>{delegationStatusLabel}</p>
        ) : null}
        {onRefreshDelegation && delegationAction.status === "error" ? (
          <button type="button" className="justify-self-end text-xs text-cyan-200 underline" onClick={onRefreshDelegation}>
            Refresh delegate status
          </button>
        ) : null}
      </section>
    </Modal>
  ) : null;

  return (
    <>
      {/* Desktop sidebar */}
      <nav aria-label="Desktop app sections" className={`hidden h-[calc(100dvh-var(--topbar-h,2.75rem))] shrink-0 flex-col border-r border-cyan-300/10 bg-[#091120] md:sticky md:top-[var(--topbar-h,2.75rem)] md:z-20 md:flex ${sidebarCollapsed ? "w-16" : "w-52"}`}>
        <div className={`flex min-h-0 flex-1 flex-col gap-2 ${sidebarCollapsed ? "p-2" : "p-2.5"}`}>
          <div id="desktop-navigation-links" className={`min-h-0 flex-1 space-y-0.5 overflow-y-auto ${sidebarCollapsed ? "" : "pr-1"}`}>
            {pages.map((page) => (
              <NavItem
                active={active === page.key || (active === "planet" && page.key === "galaxy") || (active === "alliance-inspect" && page.key === "alliance") || (active === "player-inspect" && page.key === "rankings")}
                href={buildInspectPath({ kind: "page", page: page.key })}
                icon={page.icon}
                key={page.key}
                label={page.label}
                collapsed={sidebarCollapsed}
                onClick={() => onNavigate(page.key)}
              />
            ))}
          </div>

          <button
            type="button"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!sidebarCollapsed}
            aria-controls="desktop-navigation-links"
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex min-h-11 w-full shrink-0 items-center rounded text-xs text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 ${sidebarCollapsed ? "justify-center" : "gap-2.5 px-2.5"}`}
            onClick={() => {
              const collapsed = !sidebarCollapsed;
              setSidebarCollapsed(collapsed);
              writeSidebarCollapsed(collapsed);
            }}
          >
            <span className={sidebarIconClassName}>
              {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" size={15} strokeWidth={1.9} /> : <PanelLeftClose aria-hidden="true" size={15} strokeWidth={1.9} />}
            </span>
            {sidebarCollapsed ? null : <span>Collapse</span>}
          </button>

          <details
            ref={compactAccount}
            className={`relative shrink-0 border-t border-cyan-300/10 pt-2 ${sidebarCollapsed ? "mx-auto" : ""}`}
            onKeyDown={(event) => {
              if (event.key === "Escape" && compactAccount.current?.open) {
                compactAccount.current.open = false;
                compactAccount.current.querySelector("summary")?.focus();
              }
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false;
            }}
          >
            <summary
              aria-label="Commander account"
              title="Commander account"
              className={`flex min-h-10 cursor-pointer list-none items-center rounded text-[13px] text-slate-300 transition hover:bg-white/[0.04] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 [&::-webkit-details-marker]:hidden ${sidebarCollapsed ? "min-w-10 justify-center" : "gap-2.5 px-2.5"}`}
            >
              <span className={sidebarIconClassName}><UserRound aria-hidden="true" size={15} strokeWidth={1.9} /></span>
              {sidebarCollapsed ? null : (
                <>
                  <span className="min-w-0 flex-1 truncate font-medium">{account ? playerLabel : commanderJoinCta.label}</span>
                  <ChevronsUpDown aria-hidden="true" className="shrink-0 text-slate-500" size={13} />
                </>
              )}
            </summary>
            <div className={`surface absolute z-30 w-64 max-h-[calc(100dvh-var(--topbar-h,2.75rem)-1rem)] overflow-y-auto rounded-lg p-3 shadow-2xl shadow-black/50 ${sidebarCollapsed ? "bottom-0 left-full ml-4" : "bottom-full left-0 mb-2"}`}>
              {accountSummary("")}
            </div>
          </details>
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
      {/* One slim sticky bar: menu toggle plus the always-visible planet strip. */}
      <div className="sticky top-[var(--topbar-h,2.75rem)] z-20 w-full max-w-full border-b border-cyan-300/10 bg-[#091120]/95 backdrop-blur md:hidden">
        <div className="flex h-12 min-w-0 items-center gap-1.5 pl-1.5 pr-2">
          <details
            className="shrink-0"
            onToggle={(event) => setMobileMenuOpen(event.currentTarget.open)}
            ref={mobileNavigationDetails}
          >
            <summary
              aria-controls="mobile-navigation-menu"
              aria-expanded={mobileMenuOpen}
              aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
              className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded text-slate-200 transition hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300/60 [&::-webkit-details-marker]:hidden"
              role="button"
            >
              {mobileMenuOpen ? <X aria-hidden="true" size={18} strokeWidth={2} /> : <Menu aria-hidden="true" size={18} strokeWidth={2} />}
            </summary>
            <div
              className="absolute inset-x-0 top-full grid max-h-[calc(100dvh-var(--topbar-h,2.75rem)-3rem)] min-w-0 max-w-full gap-2 overflow-y-auto rounded-b-2xl border-b border-cyan-300/15 bg-[linear-gradient(180deg,#0c1828_0%,#08111f_100%)] px-2 pb-3 pt-2 min-[375px]:gap-2.5 min-[375px]:px-3.5 sm:px-5 sm:pb-4 shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
              id="mobile-navigation-menu"
            >
              <nav aria-label="Mobile app sections" className="grid min-w-0 grid-cols-[repeat(3,minmax(0,1fr))] gap-1 min-[375px]:gap-1.5 sm:gap-2">
                {mobilePageOrder.map((page) => (
                  <MobileTab
                    active={active === page.key || (active === "planet" && page.key === "galaxy") || (active === "alliance-inspect" && page.key === "alliance") || (active === "player-inspect" && page.key === "rankings")}
                    href={buildInspectPath({ kind: "page", page: page.key })}
                    key={page.key}
                    icon={page.icon}
                    label={page.label}
                    onClick={() => handleMobileNavigate(page.key)}
                    shortLabel={page.key === "infrastructure" ? "Infra" : undefined}
                  />
                ))}
              </nav>
              {account ? (
                <div className="rounded-xl border border-cyan-300/15 bg-[linear-gradient(135deg,rgba(34,211,238,0.09),rgba(13,24,41,0.9)_60%)]">
                  <button
                    aria-controls="mobile-commander-details"
                    aria-expanded={mobileCommanderOpen}
                    className="flex h-10 w-full items-center gap-2.5 px-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300/60"
                    onClick={() => setMobileCommanderOpen((open) => !open)}
                    type="button"
                  >
                    <UserRound aria-hidden="true" className="h-4 w-4 shrink-0 text-cyan-300" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{playerLabel}</span>
                    {coordinates ? <span className="shrink-0 font-mono text-[11px] text-slate-400">{coordinates}</span> : null}
                    <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-slate-400 transition ${mobileCommanderOpen ? "rotate-180" : ""}`} />
                  </button>
                  {mobileCommanderOpen ? (
                    <div className="border-t border-cyan-300/10 px-3 pb-3 pt-2.5" id="mobile-commander-details">
                      {accountSummary("", "body")}
                    </div>
                  ) : null}
                </div>
              ) : <div className="px-1">{accountSummary("rounded-xl surface-inset p-3.5", "card")}</div>}
            </div>
          </details>
          {planetPicker ? (
            <div
              className="min-w-0 flex-1"
              // Picking a planet also closes an open menu, matching nav-item behavior.
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("button")) closeMobileMenu();
              }}
            >
              {planetPicker}
            </div>
          ) : (
            <p className="min-w-0 truncate text-sm font-semibold text-white">
              Veydrift <span className="font-mono text-[11px] font-normal text-slate-500">{coordinates ?? "--:--:--"}</span>
            </p>
          )}
        </div>
      </div>
      {playerEditorDialog}
    </>
  );
}

export function CommanderAccountSummary({
  account,
  className,
  coordinates,
  copiedField,
  layout = "list",
  onCopy,
  onEdit,
  onOpenActivity,
  playerCopyValue,
  playerLabel,
  playerPanelOpen,
  playerProfileBusy,
  playerStatusLabel,
  playerStatusTone,
}: {
  account?: string | undefined;
  className: string;
  coordinates?: string | undefined;
  copiedField: { key: string; nonce: number } | undefined;
  /** "card": roomier profile with home and wallet chips. "body": the same without the name row (the mobile
   * menu's collapsible header shows the name), with Edit beside Activity. */
  layout?: "list" | "card" | "body";
  onCopy: (key: string, value: string) => void;
  onEdit?: (() => void) | undefined;
  onOpenActivity?: (() => void) | undefined;
  playerCopyValue?: string | undefined;
  playerLabel: string;
  playerPanelOpen: boolean;
  playerProfileBusy: boolean;
  playerStatusLabel?: string | undefined;
  playerStatusTone: string;
}) {
  const chips = layout !== "list";
  const editButton = onEdit ? (
    <button
      aria-controls="commander-name-editor"
      aria-expanded={playerPanelOpen}
      aria-haspopup="dialog"
      aria-label="Edit player profile"
      className={layout === "body"
        ? "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg surface-inset px-3 text-xs font-medium text-slate-200 transition hover:text-cyan-100 disabled:cursor-not-allowed disabled:text-slate-600"
        : "inline-grid h-7 w-7 shrink-0 place-items-center rounded text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-100 disabled:cursor-not-allowed disabled:text-slate-600"}
      disabled={playerProfileBusy}
      onClick={onEdit}
      title="Edit player profile"
      type="button"
    >
      <Pencil aria-hidden="true" size={13} strokeWidth={2} />
      {layout === "body" ? "Edit" : null}
    </button>
  ) : null;
  return (
    <aside className={className} aria-label="Sidebar account summary">
      {layout === "body" ? null : <div className="flex min-w-0 items-center gap-2">
        <CopyableCommanderValue
          className={`min-w-0 flex-1 justify-start truncate text-left font-semibold text-white ${layout === "card" ? "text-base" : "text-sm"}`}
          copyKey="commander"
          copyValue={playerCopyValue}
          copiedField={copiedField}
          label="commander"
          onCopy={onCopy}
          value={playerLabel}
        />
        {editButton}
      </div>}
      {playerStatusLabel && !playerPanelOpen ? (
        <p className={`mt-1 break-words text-[11px] leading-4 ${playerStatusTone}`}>{playerStatusLabel}</p>
      ) : null}
      <dl className={chips ? `${layout === "body" ? "" : "mt-3 "}grid grid-cols-2 gap-2 text-xs` : "mt-2.5 grid gap-1.5 text-xs"}>
        <div className={chips ? "grid min-w-0 gap-0.5 rounded-lg border border-cyan-300/[0.12] bg-[#081120]/70 px-2.5 py-2" : "flex items-center justify-between gap-3"}>
          <dt className={chips ? "text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400" : "text-slate-400"}>Home</dt>
          <dd className="min-w-0">
            <CopyableCommanderValue
              className={`truncate font-mono text-slate-100 ${chips ? "justify-start" : "justify-end"}`}
              copyKey="home"
              copyValue={coordinates}
              copiedField={copiedField}
              label="home coordinates"
              onCopy={onCopy}
              value={coordinates ?? "--:--:--"}
            />
          </dd>
        </div>
        <div className={chips ? "grid min-w-0 gap-0.5 rounded-lg border border-cyan-300/[0.12] bg-[#081120]/70 px-2.5 py-2" : "flex items-center justify-between gap-3"}>
          <dt className={chips ? "text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400" : "text-slate-400"}>Wallet</dt>
          <dd className="min-w-0">
            <CopyableCommanderValue
              className={`truncate font-mono text-slate-100 ${chips ? "justify-start" : "justify-end"}`}
              copyKey="wallet"
              copyValue={account}
              copiedField={copiedField}
              label="wallet"
              onCopy={onCopy}
              value={account ? shortAddress(account) : "Disconnected"}
            />
          </dd>
        </div>
      </dl>
      {onOpenActivity || layout === "body" ? (
        <div className="mt-3 flex gap-2">
          {onOpenActivity ? (
            <button
              aria-haspopup="dialog"
              className={`flex w-full items-center gap-2 rounded-lg surface-inset px-2.5 text-xs font-medium text-slate-200 transition hover:text-cyan-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 ${chips ? "h-10 justify-center" : "h-8"}`}
              onClick={onOpenActivity}
              type="button"
            >
              <History aria-hidden="true" className="text-cyan-300/80" size={13} strokeWidth={2} />
              Activity
            </button>
          ) : null}
          {layout === "body" ? editButton : null}
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
  collapsed = false,
}: {
  active: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  collapsed?: boolean;
}) {
  return (
    <a
      aria-label={label}
      className={`relative flex w-full items-center rounded py-1.5 text-left text-[13px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300/60 ${collapsed ? "justify-center" : "gap-2.5 px-2.5"} ${
        active
          ? "bg-cyan-400/[0.08] font-medium text-cyan-100 before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-cyan-300"
          : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100"
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
      <span className={active ? sidebarIconClassName.replace("text-slate-400", "text-cyan-200") : sidebarIconClassName}>
        <Icon aria-hidden="true" size={15} strokeWidth={1.9} />
      </span>
      <span className={collapsed ? "sr-only" : "min-w-0 truncate"}>{label}</span>
      {collapsed && <RailTooltip label={label} />}
    </a>
  );
}

// Portal only the tooltip so the independently scrolling link list cannot clip it.
function RailTooltip({ label }: { label: string }) {
  const marker = useRef<HTMLSpanElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const cancelHide = () => window.clearTimeout(hideTimer.current);
  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => setPosition(null), 150);
  };
  useEffect(() => {
    const link = marker.current?.closest("a");
    if (!link) return;
    let hovered = false;
    let dismissed = false;
    // A mouse click also focuses the link; only keyboard focus should keep the label open.
    const keyboardFocused = () => document.activeElement === link && link.matches(":focus-visible");
    const update = () => {
      if (dismissed || (!hovered && !keyboardFocused())) { setPosition(null); return; }
      const rect = link.getBoundingClientRect();
      const viewport = link.parentElement?.getBoundingClientRect();
      if (!rect.width || !rect.height || !viewport
        || rect.bottom <= Math.max(0, viewport.top) || rect.top >= Math.min(window.innerHeight, viewport.bottom)
        || rect.right <= Math.max(0, viewport.left) || rect.left >= Math.min(window.innerWidth, viewport.right)) {
        setPosition(null);
        return;
      }
      setPosition({ left: (link.closest("nav")?.getBoundingClientRect().right ?? rect.right) + 8, top: rect.top + rect.height / 2 });
    };
    const enter = () => { cancelHide(); hovered = true; dismissed = false; update(); };
    const leave = () => { hovered = false; if (!keyboardFocused()) scheduleHide(); };
    const focus = () => { cancelHide(); dismissed = false; update(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { dismissed = true; setPosition(null); } };
    link.addEventListener("mouseenter", enter);
    link.addEventListener("mouseleave", leave);
    link.addEventListener("focus", focus);
    link.addEventListener("blur", update);
    window.addEventListener("keydown", escape);
    // Focus can auto-scroll the rail: reposition visible focused links, but
    // dismiss hover-only labels and labels clipped away or hidden on mobile.
    const reposition = () => {
      if (keyboardFocused()) update();
      else setPosition(null);
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    update();
    return () => {
      cancelHide();
      link.removeEventListener("mouseenter", enter);
      link.removeEventListener("mouseleave", leave);
      link.removeEventListener("focus", focus);
      link.removeEventListener("blur", update);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, []);
  return <>
    <span ref={marker} aria-hidden="true" />
    {position && createPortal(<span role="tooltip" onMouseEnter={cancelHide} onMouseLeave={scheduleHide} className="fixed z-50 -translate-y-1/2 whitespace-nowrap rounded border border-white/20 bg-[#07101d] px-3 py-2 text-xs text-white shadow-xl" style={position}>{label}</span>, document.body)}
  </>;
}

export function MobileTab({
  active,
  href,
  icon: Icon,
  label,
  onClick,
  shortLabel,
}: {
  active: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** Shown instead of the label on very narrow screens. */
  shortLabel?: string | undefined;
}) {
  return (
    <a
      className={`flex h-10 min-w-0 max-w-full items-center gap-1 overflow-hidden rounded-lg px-[5px] text-[11px] font-medium transition min-[375px]:gap-2 min-[375px]:px-2.5 sm:px-3 sm:text-xs ${
        active
          ? "bg-cyan-300 text-[#031014] shadow-[0_0_18px_rgba(103,232,249,0.3)]"
          : "border border-cyan-300/[0.12] bg-cyan-400/[0.05] text-slate-200 hover:border-cyan-300/35 hover:bg-cyan-400/10 hover:text-white"
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
      <Icon aria-hidden="true" className={`shrink-0 ${active ? "" : "text-cyan-300"}`} size={14} strokeWidth={1.9} />
      {shortLabel ? (
        <>
          {/* Narrow screens draw the short label via CSS so the link text and accessible name stay the full label. */}
          <span aria-hidden="true" className="min-w-0 leading-[1.15] before:content-[attr(data-short-label)] min-[375px]:hidden" data-short-label={shortLabel} />
          <span className="line-clamp-2 min-w-0 leading-[1.15] max-[374px]:sr-only">{label}</span>
        </>
      ) : <span className="line-clamp-2 min-w-0 leading-[1.15]">{label}</span>}
    </a>
  );
}
