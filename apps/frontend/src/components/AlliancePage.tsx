import { Check, Clock, Copy, Crown, ExternalLink, LogOut, Mail, Pencil, Plus, Scale, Shield, ShieldOff, Trash2, UserPlus, UserRound, Users, X } from "lucide-preact";
import type { LucideIcon } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { descriptionLinkParts } from "../descriptionLinks";
import { formatDurationUntil } from "../durationFormat";
import { copyReferralText } from "../referralClipboard";
import { formatUserTimestamp } from "../timestampFormat";
import type { AllianceDiplomacyStatus, AllianceRole, ChainAllianceState, HighscoreEntry, PaidAllianceBonusAmount, WalletPlanetsResponse } from "../walletFlow";
import { generatePaidAllianceInviteSecret, paidAllianceInviteLink } from "../walletFlow";
import { shortAddress } from "../walletFlow";
import { backendDataStoreFor } from "../backendDataStore";
import { refreshButtonState } from "./PageHeader";
import { VeydriftLoader } from "./VeydriftLoader";
import { AllianceSkeleton } from "./LoadingSkeletons";
import { escapeCloseRef } from "./modalDismiss";
import { GameUnavailableNotice, isGameUnavailableMessage } from "./GameUnavailableNotice";

export const allianceRosterPageSize = 10;
export const allianceDirectoryPageSize = 10;
export const warMinimumDurationCopy = "Once declared, a war cannot be ended for 48 hours.";
export const warMinimumDurationSeconds = 48 * 60 * 60;

export function allianceRefreshButtonState(loading: boolean): { disabled: boolean; label: "Refresh" | "Refreshing" } {
  return refreshButtonState(loading);
}

type AllianceActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

type DirectoryEntry = ChainAllianceState["directory"][number];
type InviteEntry = ChainAllianceState["pendingInvites"][number];
type JoinRequestEntry = ChainAllianceState["allianceJoinRequests"][number];
type RosterMember = ChainAllianceState["members"][number];

type AllianceEntry = DirectoryEntry & {
  rosterAvailable: boolean;
};

type RosterGroups = {
  all: RosterMember[];
  officers: RosterMember[];
  members: RosterMember[];
};

type AllianceControlPanel = "invite" | "paid-invites" | "profile" | "treasury";

type PlayerProfileState =
  | { status: "idle" }
  | { status: "loading"; wallet: string }
  | { status: "loaded"; wallet: string; planets: WalletPlanetsResponse | null; highscore: HighscoreEntry | null }
  | { status: "error"; wallet: string; label: string };

interface AlliancePageProps {
  actionState: AllianceActionState;
  activePlanetHasRift?: boolean | null | undefined;
  activePlanetName?: string | null | undefined;
  allianceState: ChainAllianceState | null;
  apiBaseUrl?: string | undefined;
  canTransact: boolean;
  error?: string | undefined;
  loading: boolean;
  selectedAllianceId?: string | null | undefined;
  transactionUnavailableReason?: string | undefined;
  onApproveJoinRequest: (playerAddress: string) => void;
  onAcceptInvite: (allianceId: string) => void;
  onBatchKick: (playerAddresses: string[]) => void;
  onBatchSetRole: (playerAddresses: string[], role: "member" | "officer") => void;
  onCancelJoinRequest: (allianceId: string) => void;
  onCreate: (tag: string, name: string, description: string) => void;
  onDismissJoinRequest: (playerAddress: string) => void;
  onInvite: (playerAddress: string) => void;
  onBuyPaidInvite?: ((secret: string) => void) | undefined;
  onRecoverPaidInvites?: (() => Promise<string | null>) | undefined;
  onWithdrawPaidInviteBonus?: ((amount: PaidAllianceBonusAmount) => void) | undefined;
  onJoinRequest: (allianceId: string) => void;
  onKick: (playerAddress: string) => void;
  onLeaveAlliance: () => void;
  onOpenAlliance?: ((allianceId: string) => void) | undefined;
  onOpenPlayer?: ((playerAddress: string) => void) | undefined;
  onRefresh: () => void;
  onSetRole: (playerAddress: string, role: "member" | "officer") => void;
  onSetDiplomacy: (otherAllianceId: string, status: AllianceDiplomacyStatus) => void;
  onTransferOwnership: (playerAddress: string) => void;
  onUpdateProfile: (tag: string, name: string, description: string) => void;
}

interface AllianceInvitesPageProps {
  referralProgramPanel?: ComponentChildren | undefined;
}

export function AlliancePage({
  actionState,
  activePlanetHasRift = null,
  activePlanetName,
  allianceState,
  apiBaseUrl,
  canTransact,
  error,
  loading,
  selectedAllianceId,
  transactionUnavailableReason,
  onAcceptInvite,
  onApproveJoinRequest,
  onBatchKick,
  onBatchSetRole,
  onCancelJoinRequest,
  onCreate,
  onDismissJoinRequest,
  onInvite,
  onBuyPaidInvite,
  onRecoverPaidInvites,
  onWithdrawPaidInviteBonus,
  onJoinRequest,
  onKick,
  onLeaveAlliance,
  onOpenAlliance,
  onOpenPlayer,
  onSetRole,
  onSetDiplomacy,
  onTransferOwnership,
  onUpdateProfile,
}: AlliancePageProps) {
  const [tag, setTag] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [profileTag, setProfileTag] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileDescription, setProfileDescription] = useState("");
  const [profileFormOpen, setProfileFormOpen] = useState(false);
  const [inviteAddress, setInviteAddress] = useState("");
  const [inviteFormOpen, setInviteFormOpen] = useState(false);
  const [activeAllianceId, setActiveAllianceId] = useState<string | null>(selectedAllianceId ?? null);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [playerProfile, setPlayerProfile] = useState<PlayerProfileState>({ status: "idle" });
  const [paidInviteLink, setPaidInviteLink] = useState<string | null>(null);
  const [createAllianceDialogOpen, setCreateAllianceDialogOpen] = useState(false);

  const profile = allianceState?.profile;
  const role = allianceState?.membership.role ?? "none";
  const currentAllianceId = allianceState?.membership.allianceId ?? "0";
  const isMember = hasAllianceMembership(allianceState);
  const isOwner = role === "owner";
  const canManageMembers = role === "owner" || role === "officer";
  const disabled = !canTransact || actionState.status === "pending";
  const roster = useMemo(
    () => buildAllianceRoster(allianceState?.members ?? [], profile?.owner),
    [allianceState?.members, profile?.owner]
  );
  const currentAlliance = useMemo(
    () => currentAllianceEntry(allianceState, roster.all.length),
    [allianceState, roster.all.length]
  );
  const directory = allianceState?.directory ?? [];
  const selectedAlliance = findAllianceEntry(directory, activeAllianceId, currentAlliance);
  const inspectedAlliance = selectedAlliance?.allianceId === currentAllianceId ? null : selectedAlliance;
  const initialLoading = shouldShowAllianceInitialLoader({ allianceState, loading });
  const actionLabel = actionState.status !== "idle" ? actionState.label : undefined;
  const showTransactionUnavailableNotice = shouldShowAllianceTransactionNotice({
    actionLabel,
    transactionUnavailableReason,
  });
  const openPlayer = onOpenPlayer ?? setSelectedPlayer;
  const openAlliance = onOpenAlliance ?? setActiveAllianceId;
  const exitAction = allianceExitActionState(allianceState);

  useEffect(() => {
    setProfileTag(profile?.tag ?? "");
    setProfileName(profile?.name ?? "");
    setProfileDescription(profile?.description ?? "");
  }, [profile?.tag, profile?.name, profile?.description]);

  useEffect(() => {
    setActiveAllianceId(selectedAllianceId ?? null);
  }, [selectedAllianceId]);

  useEffect(() => {
    if (!selectedPlayer || !apiBaseUrl) {
      setPlayerProfile(selectedPlayer ? { status: "loaded", wallet: selectedPlayer, planets: null, highscore: null } : { status: "idle" });
      return;
    }

    let disposed = false;
    setPlayerProfile({ status: "loading", wallet: selectedPlayer });
    const backendData = backendDataStoreFor(apiBaseUrl);
    Promise.allSettled([
      backendData.planets(selectedPlayer),
      backendData.playerHighscore(selectedPlayer),
    ]).then(([planetsResult, highscoreResult]) => {
      if (disposed) return;
      const planets = planetsResult.status === "fulfilled" ? planetsResult.value : null;
      const highscore = highscoreResult.status === "fulfilled" ? highscoreResult.value : null;
      if (!planets && !highscore) {
        const reason = planetsResult.status === "rejected" && planetsResult.reason instanceof Error
          ? planetsResult.reason.message
          : "Player profile could not be loaded.";
        setPlayerProfile({ status: "error", wallet: selectedPlayer, label: reason });
        return;
      }
      setPlayerProfile({ status: "loaded", wallet: selectedPlayer, planets, highscore });
    });

    return () => {
      disposed = true;
    };
  }, [apiBaseUrl, selectedPlayer]);

  return (
    <section className="grid min-h-0 gap-4">
      {error ? (
        isGameUnavailableMessage(error) ? <GameUnavailableNotice /> : <Notice tone="error">{error}</Notice>
      ) : null}
      {allianceState?.allianceAvailable === false ? (
        <Notice>{allianceState.unavailableReason ?? "Alliance contract is not configured."}</Notice>
      ) : null}
      {!canTransact && showTransactionUnavailableNotice ? <Notice>{transactionUnavailableReason}</Notice> : null}
      {actionState.status !== "idle" ? <Notice tone={actionState.status === "error" ? "error" : "info"}>{actionState.label}</Notice> : null}

      {initialLoading ? (
        <AllianceSkeleton />
      ) : (
        <div className={`grid min-w-0 gap-4 ${!onOpenPlayer && playerProfile.status !== "idle" ? "xl:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
          <div className="grid gap-4">
            <MyAllianceSection
              activePlanetHasRift={activePlanetHasRift}
              activePlanetName={activePlanetName}
              canManageMembers={canManageMembers}
              currentAlliance={currentAlliance}
              disabled={disabled}
              exitAction={exitAction}
              inviteAddress={inviteAddress}
              inviteFormOpen={inviteFormOpen}
              isMember={isMember}
              isOwner={isOwner}
              profileDescription={profileDescription}
              profileFormOpen={profileFormOpen}
              profileName={profileName}
              profileTag={profileTag}
              role={role}
              roster={roster}
              activeWars={allianceState?.activeWars ?? []}
              currentAllianceId={currentAllianceId}
              directory={directory}
              pendingInvites={allianceState?.pendingInvites ?? []}
              viewer={allianceState?.wallet}
              onAcceptInvite={onAcceptInvite}
              onBatchKick={onBatchKick}
              onBatchSetRole={onBatchSetRole}
              onInvite={onInvite}
              onBuyPaidInvite={onBuyPaidInvite}
              onRecoverPaidInvites={onRecoverPaidInvites}
              onWithdrawPaidInviteBonus={onWithdrawPaidInviteBonus}
              paidInviteLink={paidInviteLink}
              onSetPaidInviteLink={setPaidInviteLink}
              onKick={onKick}
              onLeaveAlliance={onLeaveAlliance}
              onOpenAlliance={onOpenAlliance}
              onOpenPlayer={openPlayer}
              onSetProfileFormOpen={setProfileFormOpen}
              onSetInviteAddress={setInviteAddress}
              onSetInviteFormOpen={setInviteFormOpen}
              onSetProfileDescription={setProfileDescription}
              onSetProfileName={setProfileName}
              onSetProfileTag={setProfileTag}
              onSetRole={onSetRole}
              onSetDiplomacy={onSetDiplomacy}
              onTransferOwnership={onTransferOwnership}
              onUpdateProfile={onUpdateProfile}
            />

            {inspectedAlliance && !onOpenAlliance ? (
              <PublicAllianceSection
                alliance={inspectedAlliance}
                onOpenPlayer={openPlayer}
              />
            ) : null}

            {canManageMembers && (allianceState?.allianceJoinRequests.length ?? 0) > 0 ? (
              <JoinRequests
                allianceState={allianceState}
                disabled={disabled}
                requests={allianceState?.allianceJoinRequests ?? []}
                onApproveJoinRequest={onApproveJoinRequest}
                onDismissJoinRequest={onDismissJoinRequest}
                onOpenPlayer={openPlayer}
              />
            ) : null}

            <DirectorySection
              alliances={directory}
              activeWars={allianceState?.activeWars ?? []}
              canDeclareWar={isOwner}
              currentAllianceId={isMember ? currentAllianceId : null}
              currentAllianceScore={profile?.totalMemberScore ?? null}
              currentAllianceMemberCount={profile?.memberCount ?? null}
              disabled={disabled}
              pendingJoinRequests={allianceState?.pendingJoinRequests ?? []}
              selectedAllianceId={selectedAlliance?.allianceId ?? null}
              onCancelJoinRequest={onCancelJoinRequest}
              onJoinRequest={onJoinRequest}
              onOpenAlliance={openAlliance}
              onSelectAlliance={setActiveAllianceId}
              onSetDiplomacy={onSetDiplomacy}
              createAlliance={!isMember ? {
                description,
                name,
                open: createAllianceDialogOpen,
                tag,
                onClose: () => setCreateAllianceDialogOpen(false),
                onOpen: () => setCreateAllianceDialogOpen(true),
                onSetDescription: setDescription,
                onSetName: setName,
                onSetTag: setTag,
                onSubmit: () => {
                  onCreate(tag.trim(), name.trim(), description.trim());
                  setCreateAllianceDialogOpen(false);
                },
              } : undefined}
            />
          </div>

          {!onOpenPlayer && playerProfile.status !== "idle" ? (
            <aside className="grid min-w-0 gap-4 content-start">
              <PlayerProfilePanel
                profile={playerProfile}
                onClose={() => setSelectedPlayer(null)}
              />
            </aside>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function AllianceInvitesPage({
  referralProgramPanel,
}: AllianceInvitesPageProps) {
  return (
    <section className="invite-page grid min-h-0 gap-4">
      {referralProgramPanel}
    </section>
  );
}

export function shouldShowAllianceInitialLoader({
  allianceState,
  loading,
}: {
  allianceState: ChainAllianceState | null;
  loading: boolean;
}): boolean {
  return loading && !allianceState;
}

export function shouldShowAllianceTransactionNotice({
  actionLabel,
  transactionUnavailableReason,
}: {
  actionLabel?: string | undefined;
  transactionUnavailableReason?: string | undefined;
}): boolean {
  return Boolean(transactionUnavailableReason && transactionUnavailableReason !== actionLabel);
}

export function hasAllianceMembership(allianceState: ChainAllianceState | null): boolean {
  return Boolean(allianceState?.profile && allianceState.membership.allianceId !== "0");
}

export function allianceJoinRequestApprovalState(
  allianceState: ChainAllianceState | null,
  request: JoinRequestEntry
): { canApprove: boolean; reason: string | null } {
  if (!allianceState) {
    return { canApprove: false, reason: "Alliance state is still loading." };
  }

  const role = allianceState.membership.role;
  if (role !== "owner" && role !== "officer") {
    return { canApprove: false, reason: "Only officers and owners can approve applications." };
  }

  const currentAllianceId = allianceState.membership.allianceId;
  if (currentAllianceId === "0" || request.allianceId !== currentAllianceId) {
    return { canApprove: false, reason: "You are not managing this alliance." };
  }

  const requester = request.requester.toLowerCase();
  const rosterMember = allianceState.members.find((member) => member.address.toLowerCase() === requester);
  const requesterAllianceId = request.requesterMembership?.allianceId ?? "0";
  if (rosterMember || requesterAllianceId === currentAllianceId) {
    return { canApprove: false, reason: "Applicant is already in this alliance." };
  }

  if (requesterAllianceId !== "0") {
    return { canApprove: false, reason: "Applicant already joined another alliance." };
  }

  return { canApprove: true, reason: null };
}

export function allianceJoinRequestDismissalState(
  allianceState: ChainAllianceState | null,
  request: JoinRequestEntry
): { canDismiss: boolean; reason: string | null } {
  if (!allianceState) {
    return { canDismiss: false, reason: "Alliance state is still loading." };
  }

  const role = allianceState.membership.role;
  if (role !== "owner" && role !== "officer") {
    return { canDismiss: false, reason: "Only officers and owners can dismiss applications." };
  }

  const currentAllianceId = allianceState.membership.allianceId;
  if (currentAllianceId === "0" || request.allianceId !== currentAllianceId) {
    return { canDismiss: false, reason: "You are not managing this alliance." };
  }

  return { canDismiss: true, reason: null };
}

export function allianceInviteAcceptanceState(
  allianceState: ChainAllianceState | null,
  invite: InviteEntry
): { canAccept: boolean; reason: string | null } {
  if (!allianceState) {
    return { canAccept: false, reason: "Alliance state is still loading." };
  }

  if (allianceState.membership.allianceId !== "0") {
    return { canAccept: false, reason: "You are already in an alliance." };
  }

  const pendingInvite = allianceState.pendingInvites.find((entry) => entry.allianceId === invite.allianceId);
  if (!pendingInvite) {
    return { canAccept: false, reason: "This invitation is no longer pending." };
  }

  const alliance = allianceState.directory.find((entry) => entry.allianceId === invite.allianceId);
  if (!alliance?.active) {
    return { canAccept: false, reason: "This alliance is unavailable." };
  }

  return { canAccept: true, reason: null };
}

export function allianceExitActionState(
  allianceState: ChainAllianceState | null
): { canSubmit: boolean; label: "Leave Alliance" | "Delete Alliance"; reason: string | null } {
  const role = allianceState?.membership.role ?? "none";
  const label = role === "owner" ? "Delete Alliance" : "Leave Alliance";

  if (!allianceState) {
    return { canSubmit: false, label, reason: "Alliance state is still loading." };
  }

  if (!hasAllianceMembership(allianceState)) {
    return { canSubmit: false, label, reason: "You are not in an alliance." };
  }

  if (role === "owner") {
    const rosterCount = buildAllianceRoster(allianceState.members, allianceState.profile?.owner).all.length;
    const memberCount = Math.max(allianceState.profile?.memberCount ?? 0, rosterCount);
    if (memberCount > 1) {
      return {
        canSubmit: false,
        label,
        reason: "Remove every other member before deleting this alliance.",
      };
    }
  }

  return { canSubmit: true, label, reason: null };
}

export function canTransferAllianceOwnership(
  member: Pick<RosterMember, "role">,
  isOwner: boolean,
  isViewer: boolean
): boolean {
  return isOwner && member.role === "officer" && !isViewer;
}

function MyAllianceSection({
  activePlanetHasRift,
  activePlanetName,
  canManageMembers,
  currentAlliance,
  disabled,
  exitAction,
  inviteAddress,
  inviteFormOpen,
  isMember,
  isOwner,
  profileDescription,
  profileFormOpen,
  profileName,
  profileTag,
  role,
  roster,
  activeWars,
  currentAllianceId,
  directory,
  pendingInvites,
  viewer,
  onAcceptInvite,
  onBatchKick,
  onBatchSetRole,
  onInvite,
  onBuyPaidInvite,
  onRecoverPaidInvites,
  onWithdrawPaidInviteBonus,
  paidInviteLink,
  onSetPaidInviteLink,
  onKick,
  onLeaveAlliance,
  onOpenAlliance,
  onOpenPlayer,
  onSetProfileFormOpen,
  onSetInviteAddress,
  onSetInviteFormOpen,
  onSetProfileDescription,
  onSetProfileName,
  onSetProfileTag,
  onSetRole,
  onSetDiplomacy,
  onTransferOwnership,
  onUpdateProfile,
}: {
  activePlanetHasRift: boolean | null;
  activePlanetName?: string | null | undefined;
  canManageMembers: boolean;
  currentAlliance: AllianceEntry | null;
  disabled: boolean;
  exitAction: { canSubmit: boolean; label: "Leave Alliance" | "Delete Alliance"; reason: string | null };
  inviteAddress: string;
  inviteFormOpen: boolean;
  isMember: boolean;
  isOwner: boolean;
  profileDescription: string;
  profileFormOpen: boolean;
  profileName: string;
  profileTag: string;
  role: AllianceRole;
  roster: RosterGroups;
  activeWars: ChainAllianceState["activeWars"];
  currentAllianceId: string | null;
  directory: DirectoryEntry[];
  pendingInvites: InviteEntry[];
  viewer?: string | undefined;
  onAcceptInvite: (allianceId: string) => void;
  onBatchKick: (playerAddresses: string[]) => void;
  onBatchSetRole: (playerAddresses: string[], role: "member" | "officer") => void;
  onInvite: (playerAddress: string) => void;
  onBuyPaidInvite?: ((secret: string) => void) | undefined;
  onRecoverPaidInvites?: (() => Promise<string | null>) | undefined;
  onWithdrawPaidInviteBonus?: ((amount: PaidAllianceBonusAmount) => void) | undefined;
  paidInviteLink: string | null;
  onSetPaidInviteLink: (link: string | null) => void;
  onKick: (playerAddress: string) => void;
  onLeaveAlliance: () => void;
  onOpenAlliance?: ((allianceId: string) => void) | undefined;
  onOpenPlayer: (playerAddress: string) => void;
  onSetProfileFormOpen: (value: boolean) => void;
  onSetInviteAddress: (value: string) => void;
  onSetInviteFormOpen: (value: boolean) => void;
  onSetProfileDescription: (value: string) => void;
  onSetProfileName: (value: string) => void;
  onSetProfileTag: (value: string) => void;
  onSetRole: (playerAddress: string, role: "member" | "officer") => void;
  onSetDiplomacy: (otherAllianceId: string, status: AllianceDiplomacyStatus) => void;
  onTransferOwnership: (playerAddress: string) => void;
  onUpdateProfile: (tag: string, name: string, description: string) => void;
}) {
  const [withdrawAmount, setWithdrawAmount] = useState<PaidAllianceBonusAmount>({
    metal: "",
    crystal: "",
    deuterium: "",
  });
  const [activeControlPanel, setActiveControlPanel] = useState<AllianceControlPanel | null>(
    profileFormOpen ? "profile" : inviteFormOpen ? "invite" : null,
  );
  const [paidInviteCopyState, setPaidInviteCopyState] = useState<{ link: string; status: "copied" | "error" } | null>(null);
  const paidInviteLinks = paidInviteLink?.split("\n").map((link) => link.trim()).filter(Boolean) ?? [];
  const hasWithdrawalAmount = Boolean(
    withdrawAmount.metal || withdrawAmount.crystal || withdrawAmount.deuterium,
  );
  const withdrawalActionLabel = activePlanetHasRift === null
    ? "Checking Rift..."
    : activePlanetHasRift
      ? `Rift resources to ${activePlanetName?.trim() || "active planet"}`
      : "No rift built";
  const toggleControlPanel = (panel: AllianceControlPanel) => {
    const next = activeControlPanel === panel ? null : panel;
    setActiveControlPanel(next);
    onSetProfileFormOpen(next === "profile");
    onSetInviteFormOpen(next === "invite");
  };

  useEffect(() => {
    if (!paidInviteCopyState || typeof window === "undefined") return;
    const timer = window.setTimeout(() => setPaidInviteCopyState(null), 2_000);
    return () => window.clearTimeout(timer);
  }, [paidInviteCopyState]);

  if (!isMember || !currentAlliance) {
    if (!pendingInvites.length) return null;

    return (
      <Panel
        title={pendingInvites.length === 1 ? "Alliance invitation" : "Alliance invitations"}
        action={<SectionIcon icon={Mail} />}
      >
        <div className="grid gap-2">
          {pendingInvites.map((invite) => {
            const alliance = directory.find((entry) => entry.allianceId === invite.allianceId);
            return (
              <div className="grid gap-3 rounded border border-cyan-200/20 bg-cyan-200/[0.05] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={invite.allianceId}>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {alliance ? (
                      <>
                        <span className="rounded border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 font-mono text-xs font-semibold text-cyan-100">{alliance.tag}</span>
                        <span className="truncate text-sm font-semibold text-white">{alliance.name}</span>
                      </>
                    ) : (
                      <span className="text-sm font-semibold text-white">Alliance #{invite.allianceId}</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Invited by {playerLabel(invite.inviterDisplayName, invite.inviter)} · {formatUserTimestamp(invite.invitedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  {alliance && onOpenAlliance ? (
                    <button
                      className="h-10 rounded border border-white/10 px-3 text-sm font-semibold text-slate-200 hover:bg-white/10"
                      onClick={() => onOpenAlliance(alliance.allianceId)}
                      type="button"
                    >
                      Details
                    </button>
                  ) : null}
                  <button
                    className="h-10 rounded bg-cyan-300 px-3 text-sm font-semibold text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={disabled}
                    onClick={() => onAcceptInvite(invite.allianceId)}
                    type="button"
                  >
                    Accept Invite
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="My Alliance" action={<RolePill role={role} />}>
      <div className="grid gap-3">
        <div className="min-w-0">
          <div className="min-w-0">
            <div className="min-w-0">
              <button
                className="flex min-w-0 flex-wrap items-center gap-2 text-left disabled:cursor-default"
                disabled={!onOpenAlliance}
                onClick={() => onOpenAlliance?.(currentAlliance.allianceId)}
                title="Open dedicated alliance page"
                type="button"
              >
                <span className="rounded border border-cyan-300/35 bg-cyan-300/10 px-2 py-1 font-mono text-xs font-semibold text-cyan-100">
                  {currentAlliance.tag}
                </span>
                <h3 className="min-w-0 text-base font-semibold text-white">{currentAlliance.name}</h3>
              </button>
              <p className="mt-1 max-w-3xl whitespace-pre-wrap break-words text-sm text-slate-400">
                <AllianceDescription description={currentAlliance.description} fallback="No public alliance description." />
              </p>
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <span>{formatScore(currentAlliance.totalMemberScore)} score</span>
                <span aria-hidden="true">·</span>
                <span>Created {formatUserTimestamp(currentAlliance.createdAt)}</span>
                {activeWars.length ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-rose-200">{activeWars.length} active {activeWars.length === 1 ? "war" : "wars"}</span>
                  </>
                ) : null}
              </p>
            </div>
          </div>
        </div>

        <div aria-label="Alliance management" className="flex flex-wrap border-b border-white/10" role="tablist">
              {canManageMembers ? (
                <AllianceControlTab
                  active={activeControlPanel === "invite"}
                  icon={UserPlus}
                  label="Invite Member"
                  onClick={() => toggleControlPanel("invite")}
                />
              ) : null}
              <AllianceControlTab
                active={activeControlPanel === "paid-invites"}
                icon={Mail}
                label="Private Invites"
                onClick={() => toggleControlPanel("paid-invites")}
              />
              {canManageMembers ? (
                <AllianceControlTab
                  active={activeControlPanel === "treasury"}
                  icon={Shield}
                  label="Treasury"
                  onClick={() => toggleControlPanel("treasury")}
                />
              ) : null}
              {isOwner ? (
                <AllianceControlTab
                  active={activeControlPanel === "profile"}
                  icon={Pencil}
                  label="Edit"
                  onClick={() => toggleControlPanel("profile")}
                />
              ) : null}
        </div>

        {activeControlPanel === "paid-invites" ? (
          <AllianceManagementPanel description={<AlliancePrivateInviteExplanation />}>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className={allianceManagementPrimaryActionClass}
                disabled={disabled || !onBuyPaidInvite}
                onClick={() => {
                  const secret = generatePaidAllianceInviteSecret();
                  const link = paidAllianceInviteLink(secret, typeof window === "undefined" ? "https://veydrift.com" : window.location.origin);
                  onSetPaidInviteLink(link);
                  onBuyPaidInvite?.(secret);
                }}
                type="button"
              >
                Buy private invite · 0.006 ETH (~$10)
              </button>
              {canManageMembers ? (
                <button
                  className={allianceManagementSecondaryActionClass}
                  disabled={disabled || !onRecoverPaidInvites}
                  onClick={() => void onRecoverPaidInvites?.().then(onSetPaidInviteLink)}
                  type="button"
                >
                  Recover alliance invite links
                </button>
              ) : null}
            </div>
            {canManageMembers && paidInviteLinks.length ? (
              <div className="mt-3 border-t border-white/10 pt-3">
                <p className="mb-2 text-xs text-amber-100">Share only after purchase confirmation.</p>
                <div className="grid gap-2">
                  {paidInviteLinks.map((link, index) => {
                    const copyStatus = paidInviteCopyState?.link === link ? paidInviteCopyState.status : null;
                    return (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-black/20 px-3 py-2" key={link}>
                        <div className="flex min-w-0 items-center gap-2">
                          <Mail className="shrink-0 text-cyan-200" size={15} />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-200">{paidInviteLinks.length === 1 ? "Private invite ready" : `Private invite ${index + 1}`}</p>
                            <p className="text-xs text-slate-500">Unique · single-use</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <a className={allianceManagementSecondaryActionClass} href={link} rel="noopener noreferrer" target="_blank">
                            <ExternalLink size={14} />
                            Open invite
                          </a>
                          <button
                            className={allianceManagementPrimaryActionClass}
                            onClick={() => void copyReferralText(link).then((outcome) => setPaidInviteCopyState({
                              link,
                              status: outcome === "copied" ? "copied" : "error",
                            }))}
                            type="button"
                          >
                            {copyStatus === "copied" ? <Check size={14} /> : <Copy size={14} />}
                            {copyStatus === "copied" ? "Link copied" : copyStatus === "error" ? "Copy failed" : "Copy link"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </AllianceManagementPanel>
        ) : null}

        {activeControlPanel === "treasury" && canManageMembers ? (
          <AllianceManagementPanel description={<AllianceTreasuryExplanation />}>
            <div className="grid gap-2 sm:grid-cols-3 sm:items-end 2xl:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
              {(["metal", "crystal", "deuterium"] as const).map((resource) => (
                <AllianceTreasuryResourceField
                  key={resource}
                  label={resource}
                  max={currentAlliance.bonusBalance?.[resource]}
                  value={withdrawAmount[resource]}
                  onChange={(value) => setWithdrawAmount((current) => ({ ...current, [resource]: value }))}
                />
              ))}
              <button
                className={`${allianceManagementPrimaryActionClass} sm:col-span-3 2xl:col-span-1`}
                disabled={disabled || !onWithdrawPaidInviteBonus || !hasWithdrawalAmount || activePlanetHasRift !== true}
                onClick={() => onWithdrawPaidInviteBonus?.({
                  metal: withdrawAmount.metal || "0",
                  crystal: withdrawAmount.crystal || "0",
                  deuterium: withdrawAmount.deuterium || "0",
                })}
                type="button"
              >
                {withdrawalActionLabel}
              </button>
            </div>
          </AllianceManagementPanel>
        ) : null}

        {activeControlPanel === "invite" && canManageMembers ? (
          <AllianceManagementPanel description="Invite an existing settled commander directly by wallet address.">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <TextField label="Member wallet" value={inviteAddress} onInput={onSetInviteAddress} placeholder="0x..." />
              <button
                className={`${allianceManagementPrimaryActionClass} self-end`}
                disabled={disabled || !inviteAddress.trim()}
                onClick={() => onInvite(inviteAddress.trim())}
                type="button"
              >
                <UserPlus size={15} />
                Send Invite
              </button>
            </div>
          </AllianceManagementPanel>
        ) : null}

        {activeControlPanel === "profile" && isOwner ? (
          <AllianceManagementPanel description="Update the public identity shown in the alliance directory.">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Tag" value={profileTag} onInput={onSetProfileTag} placeholder="VDFT" />
              <TextField label="Name" value={profileName} onInput={onSetProfileName} placeholder="Veydrift Union" />
            </div>
            <div className="mt-3">
              <TextArea label="Description" value={profileDescription} onInput={onSetProfileDescription} placeholder="Public alliance description" />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
              <AllianceExitActionButton
                disabled={disabled}
                exitAction={exitAction}
                onSubmit={onLeaveAlliance}
              />
              <button
                className={allianceManagementPrimaryActionClass}
                disabled={disabled || !profileTag.trim() || !profileName.trim()}
                onClick={() => onUpdateProfile(profileTag.trim(), profileName.trim(), profileDescription.trim())}
                type="button"
              >
                <Check size={15} />
                Save Profile
              </button>
            </div>
          </AllianceManagementPanel>
        ) : null}

        {activeWars.length ? (
          <WarSection
            activeWars={activeWars}
            disabled={disabled}
            canEndWar={canManageMembers}
            currentAllianceId={currentAllianceId}
            onSetDiplomacy={onSetDiplomacy}
          />
        ) : null}

        <RosterSection
          canManageMembers={canManageMembers}
          disabled={disabled}
          isOwner={isOwner}
          roster={roster}
          viewer={viewer}
          exitAction={exitAction}
          onBatchKick={onBatchKick}
          onBatchSetRole={onBatchSetRole}
          onKick={onKick}
          onLeaveAlliance={onLeaveAlliance}
          onOpenPlayer={onOpenPlayer}
          onSetRole={onSetRole}
          onTransferOwnership={onTransferOwnership}
        />
      </div>
    </Panel>
  );
}

type CreateAllianceControl = {
  description: string;
  name: string;
  open: boolean;
  tag: string;
  onClose: () => void;
  onOpen: () => void;
  onSetDescription: (value: string) => void;
  onSetName: (value: string) => void;
  onSetTag: (value: string) => void;
  onSubmit: () => void;
};

function DirectorySection({
  activeWars,
  alliances,
  canDeclareWar,
  createAlliance,
  currentAllianceId,
  currentAllianceScore,
  currentAllianceMemberCount,
  disabled,
  pendingJoinRequests,
  selectedAllianceId,
  onCancelJoinRequest,
  onJoinRequest,
  onOpenAlliance,
  onSelectAlliance,
  onSetDiplomacy,
}: {
  activeWars: ChainAllianceState["activeWars"];
  alliances: DirectoryEntry[];
  canDeclareWar: boolean;
  createAlliance?: CreateAllianceControl | undefined;
  currentAllianceId: string | null;
  currentAllianceScore: string | null;
  currentAllianceMemberCount: number | null;
  disabled: boolean;
  pendingJoinRequests: ChainAllianceState["pendingJoinRequests"];
  selectedAllianceId: string | null;
  onCancelJoinRequest: (allianceId: string) => void;
  onJoinRequest: (allianceId: string) => void;
  onOpenAlliance?: ((allianceId: string) => void) | undefined;
  onSelectAlliance: (allianceId: string) => void;
  onSetDiplomacy: (otherAllianceId: string, status: AllianceDiplomacyStatus) => void;
}) {
  const pendingIds = new Set(pendingJoinRequests.map((request) => request.allianceId));
  const activeWarIds = new Set(activeWars.map((war) => war.otherAllianceId));
  const visibleAlliances = sortedAllianceDirectory(alliances);
  const [page, setPage] = useState(1);
  const [warDeclarationTarget, setWarDeclarationTarget] = useState<DirectoryEntry | null>(null);
  const clampedPage = clampDirectoryPage(page, visibleAlliances.length);
  const pageCount = directoryPageCount(visibleAlliances.length);
  const pageRows = directoryPageRows(visibleAlliances, clampedPage);

  useEffect(() => {
    setPage((current) => clampDirectoryPage(current, visibleAlliances.length));
  }, [visibleAlliances.length]);

  return (
    <div className="scroll-mt-4" id="alliance-directory">
      <Panel
        title="Alliance directory"
        action={(visibleAlliances.length || createAlliance) ? (
          <div className="flex items-center gap-2">
            {visibleAlliances.length ? (
              <span className="rounded border border-white/10 bg-black/20 px-2 py-1 text-xs font-semibold text-slate-400">
                {visibleAlliances.length} {visibleAlliances.length === 1 ? "alliance" : "alliances"}
              </span>
            ) : null}
            {createAlliance ? (
              <button
                aria-label="Create alliance"
                className="inline-flex h-8 w-8 items-center justify-center rounded border border-cyan-300/25 bg-cyan-300/[0.08] text-cyan-100 hover:bg-cyan-300/15"
                onClick={createAlliance.onOpen}
                title="Create alliance"
                type="button"
              >
                <Plus size={16} />
              </button>
            ) : null}
          </div>
        ) : undefined}
      >
        {visibleAlliances.length ? (
          <div className="grid gap-2">
            {pageRows.map((alliance, index) => {
              const rank = (clampedPage - 1) * allianceDirectoryPageSize + index + 1;
            const pending = pendingIds.has(alliance.allianceId);
            const selected = selectedAllianceId === alliance.allianceId;
            const warAction = allianceDirectoryWarActionState({
              activeWarAllianceIds: activeWarIds,
              allianceId: alliance.allianceId,
              canDeclareWar,
              currentAllianceId,
            });
            return (
              <div
                className={`grid gap-3 rounded border p-3 md:grid-cols-[2.25rem_minmax(0,1fr)_auto] md:items-center ${
                  selected ? "border-cyan-300/35 bg-cyan-300/[0.08]" : "border-white/10 bg-black/20"
                }`}
                key={alliance.allianceId}
              >
                <span className="hidden text-center font-mono text-xs font-semibold tabular-nums text-slate-500 md:block">#{rank}</span>
                <div className="min-w-0">
                  <button
                    className="flex min-w-0 flex-wrap items-center gap-2 text-left"
                    onClick={() => onOpenAlliance ? onOpenAlliance(alliance.allianceId) : onSelectAlliance(alliance.allianceId)}
                    type="button"
                  >
                    <span className="rounded border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs font-semibold text-cyan-100">
                      {alliance.tag}
                    </span>
                    <span className="truncate text-sm font-semibold text-white">{alliance.name}</span>
                    <span className="font-mono text-xs text-slate-500">ID {alliance.allianceId}</span>
                  </button>
                  <p className="mt-2 line-clamp-2 break-words text-sm text-slate-400">
                    <AllianceDescription description={alliance.description} fallback="No public description." />
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span>{memberCountLabel(alliance.memberCount)}</span>
                    <span>Score {formatScore(alliance.totalMemberScore)}</span>
                    <span>Owner {playerLabel(alliance.ownerDisplayName, alliance.owner)}</span>
                    <span>Created {formatUserTimestamp(alliance.createdAt)}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <button
                    className="rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10"
                    onClick={() => onOpenAlliance ? onOpenAlliance(alliance.allianceId) : onSelectAlliance(alliance.allianceId)}
                    type="button"
                  >
                    Details
                  </button>
                  {currentAllianceId ? null : (
                    <button
                      className="rounded border border-cyan-300/25 px-3 py-2 text-sm font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={disabled}
                      onClick={() => pending ? onCancelJoinRequest(alliance.allianceId) : onJoinRequest(alliance.allianceId)}
                      type="button"
                    >
                      {pending ? "Cancel Request" : "Request Join"}
                    </button>
                  )}
                  {warAction.atWar ? (
                    <span className="rounded border border-rose-300/25 bg-rose-300/[0.08] px-3 py-2 text-sm font-semibold text-rose-100">
                      At War
                    </span>
                  ) : null}
                  {warAction.canDeclare ? (
                    <button
                      className="rounded border border-rose-300/30 px-3 py-2 text-sm font-semibold text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={disabled}
                      onClick={() => setWarDeclarationTarget(alliance)}
                      type="button"
                    >
                      Declare War
                    </button>
                  ) : null}
                </div>
              </div>
            );
            })}
            {pageCount > 1 ? (
              <DirectoryPagination
                page={clampedPage}
                pageCount={pageCount}
                total={visibleAlliances.length}
                onNext={() => setPage((current) => Math.min(pageCount, current + 1))}
                onPrevious={() => setPage((current) => Math.max(1, current - 1))}
              />
            ) : null}
            {warDeclarationTarget ? (
              <WarDeclarationDialog
                alliance={warDeclarationTarget}
                declarerScore={currentAllianceScore}
                declarerMemberCount={currentAllianceMemberCount}
                disabled={disabled}
                onCancel={() => setWarDeclarationTarget(null)}
                onConfirm={() => {
                  onSetDiplomacy(warDeclarationTarget.allianceId, "war");
                  setWarDeclarationTarget(null);
                }}
              />
            ) : null}
          </div>
        ) : (
          <div className="rounded border border-dashed border-white/10 bg-black/10 px-4 py-8 text-center">
            <Users className="mx-auto text-slate-600" size={22} />
            <p className="mt-3 text-sm font-semibold text-slate-300">No public alliances yet</p>
            <p className="mt-1 text-xs text-slate-500">Create the first alliance and start recruiting commanders.</p>
          </div>
        )}
      </Panel>
      {createAlliance?.open ? (
        <CreateAllianceDialog
          description={createAlliance.description}
          disabled={disabled}
          name={createAlliance.name}
          tag={createAlliance.tag}
          onCancel={createAlliance.onClose}
          onSetDescription={createAlliance.onSetDescription}
          onSetName={createAlliance.onSetName}
          onSetTag={createAlliance.onSetTag}
          onSubmit={createAlliance.onSubmit}
        />
      ) : null}
    </div>
  );
}

function CreateAllianceDialog({
  description,
  disabled,
  name,
  tag,
  onCancel,
  onSetDescription,
  onSetName,
  onSetTag,
  onSubmit,
}: {
  description: string;
  disabled: boolean;
  name: string;
  tag: string;
  onCancel: () => void;
  onSetDescription: (value: string) => void;
  onSetName: (value: string) => void;
  onSetTag: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div
      aria-labelledby="create-alliance-title"
      aria-modal="true"
      className="modal-backdrop-enter fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      ref={escapeCloseRef(onCancel)}
      role="dialog"
    >
      <div className="modal-panel-enter w-full max-w-xl rounded border border-white/15 bg-slate-950 p-4 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-white" id="create-alliance-title">Create Alliance</h3>
          <button
            aria-label="Close create alliance dialog"
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-white/10 text-slate-300 hover:bg-white/10"
            onClick={onCancel}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <TextField label="Tag" value={tag} onInput={onSetTag} placeholder="VDFT" />
          <TextField label="Name" value={name} onInput={onSetName} placeholder="Veydrift Union" />
        </div>
        <div className="mt-3">
          <TextArea
            label="Description"
            value={description}
            onInput={onSetDescription}
            placeholder="Public charter, coordination notes, or Discord link"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || !tag.trim() || !name.trim()}
            onClick={onSubmit}
            type="button"
          >
            Create Alliance
          </button>
        </div>
      </div>
    </div>
  );
}

function WarDeclarationDialog({
  alliance,
  declarerScore,
  declarerMemberCount,
  disabled,
  onCancel,
  onConfirm,
}: {
  alliance: Pick<DirectoryEntry, "memberCount" | "name" | "tag" | "totalMemberScore">;
  declarerScore: string | null;
  declarerMemberCount: number | null;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const snapshotTooLarge = (declarerMemberCount ?? 0) > 64 || alliance.memberCount > 64;
  return (
    <div
      aria-modal="true"
      className="modal-backdrop-enter fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      ref={escapeCloseRef(onCancel)}
      role="dialog"
    >
      <div className="modal-panel-enter w-full max-w-md rounded border border-rose-300/30 bg-slate-950 p-4 shadow-2xl">
        <h3 className="text-lg font-semibold text-white">Declare war on {alliance.tag}</h3>
        <ul className="mt-3 grid gap-2">
          <WarDeclarationRule icon={Users}>
            War scores and rosters are locked on-chain at declaration. Late joins and members who leave or rejoin get no war exceptions.
          </WarDeclarationRule>
          <WarDeclarationRule icon={Clock} tone="rose">
            {warMinimumDurationCopy}
          </WarDeclarationRule>
          <WarDeclarationProtectionWarning allianceName={alliance.tag} declarerScore={declarerScore} declareeScore={alliance.totalMemberScore ?? null} />
          <WarDeclarationRule icon={ShieldOff} tone="amber">
            Defender advantage: {alliance.tag}&apos;s original members bypass score protection when attacking your original members. Your alliance does not receive this protection as the declarer.
          </WarDeclarationRule>
          {snapshotTooLarge ? (
            <WarDeclarationRule icon={X} tone="rose">
              War unavailable: each alliance can snapshot at most 64 members.
            </WarDeclarationRule>
          ) : null}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10" disabled={disabled} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="rounded border border-rose-300/40 bg-rose-300/10 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-300/20 disabled:cursor-not-allowed disabled:opacity-50" disabled={disabled || snapshotTooLarge} onClick={onConfirm} type="button">
            Confirm War Declaration
          </button>
        </div>
      </div>
    </div>
  );
}

export function WarDeclarationProtectionWarning({
  allianceName,
  declarerScore,
  declareeScore,
}: {
  allianceName: string;
  declarerScore: string | null;
  declareeScore: string | null;
}) {
  try {
    if (declarerScore === null || declareeScore === null) throw new Error("missing score");
    const declarer = BigInt(declarerScore);
    const declaree = BigInt(declareeScore);
    if (declaree === 0n || declarer * 10_000n > declaree * 15_000n) {
      return <WarDeclarationRule icon={Scale} tone="amber">
        Alliance score check failed: your total is more than 1.5× {allianceName}&apos;s, so war will not bypass score protection when you attack.
      </WarDeclarationRule>;
    }
    return <WarDeclarationRule icon={Scale} tone="cyan">
      Two score checks apply when you attack {allianceName}: your alliance total must be no more than 1.5× theirs, and each attacker must be no more than 1.5× their target.
    </WarDeclarationRule>;
  } catch {
    return <WarDeclarationRule icon={Scale} tone="amber">
      Two score checks apply: your alliance total must be within 1.5× of the defender, and each attacker must be no more than 1.5× their target.
    </WarDeclarationRule>;
  }
}

function WarDeclarationRule({
  children,
  icon: Icon,
  tone = "neutral",
}: {
  children: ComponentChildren;
  icon: LucideIcon;
  tone?: "amber" | "cyan" | "neutral" | "rose";
}) {
  const toneClass = tone === "rose"
    ? "text-rose-100"
    : tone === "amber"
      ? "text-amber-100"
      : tone === "cyan"
        ? "text-cyan-100"
        : "text-slate-300";
  return (
    <li className={`flex items-start gap-2 text-sm leading-relaxed ${toneClass}`}>
      <Icon className="mt-0.5 shrink-0" size={15} />
      <span>{children}</span>
    </li>
  );
}

export function allianceDirectoryWarActionState({
  activeWarAllianceIds,
  allianceId,
  canDeclareWar,
  currentAllianceId,
}: {
  activeWarAllianceIds: ReadonlySet<string>;
  allianceId: string;
  canDeclareWar: boolean;
  currentAllianceId: string | null;
}): { atWar: boolean; canDeclare: boolean } {
  const atWar = activeWarAllianceIds.has(allianceId);
  return {
    atWar,
    canDeclare: canDeclareWar && Boolean(currentAllianceId) && currentAllianceId !== "0" && currentAllianceId !== allianceId && !atWar,
  };
}

function PublicAllianceSection({
  alliance,
  onOpenPlayer,
}: {
  alliance: AllianceEntry;
  onOpenPlayer: (playerAddress: string) => void;
}) {
  return (
    <Panel title="Alliance" action={<SectionIcon icon={Shield} />}>
      <AllianceSummary alliance={alliance} onOpenPlayer={onOpenPlayer} />
    </Panel>
  );
}

function AllianceBonusBalance({
  balance,
}: {
  balance: { metal: string; crystal: string; deuterium: string } | null | undefined;
}) {
  return (
    <div className="mt-3 rounded border border-cyan-300/20 bg-cyan-300/[0.05] p-3" aria-label="Alliance production bonus balance">
      <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100">Alliance treasury</h4>
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm text-slate-200">
        <span><small className="block text-slate-500">Metal</small>{formatAllianceResource(balance?.metal)}</span>
        <span><small className="block text-slate-500">Crystal</small>{formatAllianceResource(balance?.crystal)}</span>
        <span><small className="block text-slate-500">Deuterium</small>{formatAllianceResource(balance?.deuterium)}</span>
      </div>
    </div>
  );
}

function formatAllianceResource(value: string | undefined): string {
  if (value === undefined) return "Unavailable";
  try {
    return BigInt(value).toLocaleString();
  } catch {
    return value;
  }
}

function WarSection({
  activeWars,
  canEndWar,
  currentAllianceId,
  disabled,
  onSetDiplomacy,
}: {
  activeWars: ChainAllianceState["activeWars"];
  canEndWar: boolean;
  currentAllianceId: string | null;
  disabled: boolean;
  onSetDiplomacy: (otherAllianceId: string, status: AllianceDiplomacyStatus) => void;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (activeWars.length === 0) return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [activeWars.length]);

  return (
    <div className="rounded border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Wars</h3>
        <span className="text-xs text-slate-500">{activeWars.length}</span>
      </div>

      {activeWars.length ? (
        <div className="mt-2 grid gap-1.5">
          {activeWars.map((war) => {
            const alliance = war.alliance;
            const endAction = allianceWarEndActionState({
              canEndWar,
              currentAllianceId,
              declaredAt: war.declaredAt,
              initiatedByAllianceId: war.initiatedByAllianceId,
              nowSeconds: Math.floor(nowMs / 1_000),
            });
            return (
              <div className="grid gap-2 rounded border border-rose-300/25 bg-rose-300/[0.06] px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={war.otherAllianceId}>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="rounded border border-rose-300/40 bg-rose-400/15 px-2 py-1 font-mono text-xs font-semibold text-rose-100">
                      {alliance?.tag ?? `#${war.otherAllianceId}`}
                    </span>
                    <span className="truncate text-sm font-semibold text-white">{alliance?.name ?? `Alliance #${war.otherAllianceId}`}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">War is restricted to its declaration snapshot: late joins receive no exceptions. The declarer has no score protection against this alliance; declarer attacks use the 1.5× score checks. {warMinimumDurationCopy}</p>
                  {war.warSnapshot ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Snapshot — declarer score {formatScore(war.warSnapshot.declarerScore)} ({war.warSnapshot.declarerMemberCount} members), declaree score {formatScore(war.warSnapshot.declareeScore)} ({war.warSnapshot.declareeMemberCount} members).
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-amber-200">Legacy war: no protection snapshot exists, so normal score protection applies.</p>
                  )}
                </div>
                {endAction.visible ? (
                  <div className="justify-self-start sm:justify-self-end">
                    <button
                      aria-disabled={!endAction.enabled}
                      className={`rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 ${
                        endAction.enabled ? "hover:bg-white/10" : "cursor-not-allowed opacity-50"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                      disabled={disabled || !endAction.enabled}
                      onClick={() => {
                        if (!endAction.enabled) return;
                        onSetDiplomacy(war.otherAllianceId, "none");
                      }}
                      title={endAction.reason ?? "End war"}
                      type="button"
                    >
                      End War
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-400">No active wars.</p>
      )}
    </div>
  );
}

export function allianceWarEndActionState({
  canEndWar,
  currentAllianceId,
  declaredAt,
  initiatedByAllianceId,
  nowSeconds = Math.floor(Date.now() / 1_000),
}: {
  canEndWar: boolean;
  currentAllianceId: string | null;
  declaredAt: string | null | undefined;
  initiatedByAllianceId: string | null | undefined;
  nowSeconds?: number;
}): { visible: boolean; enabled: boolean; reason: string | null } {
  if (!canEndWar) return { visible: false, enabled: false, reason: null };
  if (!currentAllianceId || !initiatedByAllianceId) {
    return { visible: true, enabled: false, reason: "Only the alliance that declared this war can end it." };
  }
  if (currentAllianceId !== initiatedByAllianceId) {
    return { visible: true, enabled: false, reason: "Only the alliance that declared this war can end it." };
  }
  const declaredAtSeconds = Number(declaredAt);
  if (!Number.isFinite(declaredAtSeconds) || declaredAtSeconds <= 0) {
    return { visible: true, enabled: false, reason: "War declaration time is unavailable; End War remains locked." };
  }
  const unlocksAtSeconds = declaredAtSeconds + warMinimumDurationSeconds;
  if (nowSeconds < unlocksAtSeconds) {
    return {
      visible: true,
      enabled: false,
      reason: `War can be ended in ${formatDurationUntil(unlocksAtSeconds * 1_000, nowSeconds * 1_000)}.`,
    };
  }
  return { visible: true, enabled: true, reason: null };
}

export function AllianceSummary({
  alliance,
  onOpenPlayer,
}: {
  alliance: Pick<AllianceEntry, "bonusBalance" | "createdAt" | "description" | "memberCount" | "name" | "owner" | "ownerDisplayName" | "privateInviteStats" | "tag" | "totalMemberScore">;
  onOpenPlayer: (playerAddress: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="rounded border border-cyan-300/35 bg-cyan-300/10 px-2 py-1 font-mono text-xs font-semibold text-cyan-100">
            {alliance.tag}
          </span>
          <h3 className="min-w-0 text-base font-semibold text-white">{alliance.name}</h3>
        </div>
        <p className="mt-2 max-w-3xl whitespace-pre-wrap break-words text-sm text-slate-400">
          <AllianceDescription description={alliance.description} fallback="No public alliance description." />
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <MiniStat label="Members" value={memberCountLabel(alliance.memberCount)} />
        <MiniStat label="Score" value={formatScore(alliance.totalMemberScore)} />
        <MiniStat label="Created" value={formatUserTimestamp(alliance.createdAt)} />
        <MiniStat label="Invites left" value={formatAllianceInviteCount(alliance.privateInviteStats?.remaining)} />
        <MiniStat label="Invites used" value={formatAllianceInviteCount(alliance.privateInviteStats?.used)} />
      </div>
      <AllianceBonusBalance balance={alliance.bonusBalance} />
      <button
        className="rounded border border-white/10 bg-black/20 px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10"
        onClick={() => onOpenPlayer(alliance.owner)}
        type="button"
      >
        Owner <span className="font-mono text-cyan-100">{playerLabel(alliance.ownerDisplayName, alliance.owner)}</span>
      </button>
    </div>
  );
}

function formatAllianceInviteCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "Unavailable" : value.toLocaleString();
}

export function AllianceDescription({
  description,
  fallback,
}: {
  description: string | null | undefined;
  fallback: string;
}) {
  const value = description?.trim();
  if (!value) return <>{fallback}</>;

  return (
    <>
      {descriptionLinkParts(value).map((part, index) => part.href ? (
        <a
          className="break-all text-cyan-200 underline decoration-cyan-300/40 underline-offset-2 hover:text-cyan-100"
          href={part.href}
          key={`${part.href}-${index}`}
          rel="noreferrer noopener"
          target="_blank"
          onClick={(event) => event.stopPropagation()}
        >
          {part.text}
        </a>
      ) : (
        <span key={`${part.text}-${index}`}>{part.text}</span>
      ))}
    </>
  );
}

function JoinRequests({
  allianceState,
  disabled,
  requests,
  onApproveJoinRequest,
  onDismissJoinRequest,
  onOpenPlayer,
}: {
  allianceState: ChainAllianceState | null;
  disabled: boolean;
  requests: ChainAllianceState["allianceJoinRequests"];
  onApproveJoinRequest: (playerAddress: string) => void;
  onDismissJoinRequest: (playerAddress: string) => void;
  onOpenPlayer: (playerAddress: string) => void;
}) {
  return (
    <Panel title="Join Applications">
      {requests.length ? (
        <div className="grid gap-2">
          {requests.map((request) => {
            const approval = allianceJoinRequestApprovalState(allianceState, request);
            const dismissal = allianceJoinRequestDismissalState(allianceState, request);
            return (
              <div className="rounded border border-white/10 bg-black/20 p-3" key={request.requester}>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                  <div className="min-w-0">
                    <PlayerRowInfo
                      address={request.requester}
                      badge="Applicant"
                      displayName={request.requesterDisplayName}
                      icon={<UserRound size={14} className="text-slate-500" />}
                      timestamp={request.requestedAt}
                      timestampLabel="Requested"
                      totalScore={request.requesterTotalScore}
                      onOpenPlayer={onOpenPlayer}
                    />
                    {approval.reason ? <p className="mt-2 rounded border border-amber-300/20 bg-amber-300/10 px-2 py-1.5 text-xs text-amber-100">{approval.reason}</p> : null}
                  </div>
                  <div className="grid gap-2 md:w-44">
                    <button
                      className="w-full rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={disabled || !approval.canApprove}
                      onClick={() => onApproveJoinRequest(request.requester)}
                      type="button"
                    >
                      Approve Member
                    </button>
                    {dismissal.canDismiss || dismissal.reason ? (
                      <button
                        className="w-full rounded border border-red-300/25 px-3 py-2 text-sm font-semibold text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={disabled || !dismissal.canDismiss}
                        onClick={() => onDismissJoinRequest(request.requester)}
                        type="button"
                      >
                        Dismiss application
                      </button>
                    ) : null}
                  </div>
                </div>
                {dismissal.reason ? (
                  <p className="mt-2 rounded border border-amber-300/20 bg-amber-300/10 px-2 py-1.5 text-xs text-amber-100">{dismissal.reason}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-400">No pending applications.</p>
      )}
    </Panel>
  );
}

function PlayerRowInfo({
  address,
  badge,
  displayName,
  icon,
  timestamp,
  timestampLabel,
  totalScore,
  onOpenPlayer,
}: {
  address: string;
  badge: string;
  displayName?: string | null | undefined;
  icon: ComponentChildren;
  timestamp: string;
  timestampLabel: string;
  totalScore?: string | undefined;
  onOpenPlayer: (playerAddress: string) => void;
}) {
  return (
    <button className="min-w-0 text-left" onClick={() => onOpenPlayer(address)} type="button">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {icon}
        <span className="font-mono text-sm text-white">{playerLabel(displayName, address)}</span>
        {displayName ? (
          <span className="font-mono text-xs text-slate-500">{shortAddress(address)}</span>
        ) : null}
        <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-300">
          {badge}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Score {formatScore(totalScore)} / {timestampLabel} {formatUserTimestamp(timestamp)}
      </p>
    </button>
  );
}

export function AllianceExitActionButton({
  disabled,
  exitAction,
  onSubmit,
}: {
  disabled: boolean;
  exitAction: { canSubmit: boolean; label: "Leave Alliance" | "Delete Alliance"; reason: string | null };
  onSubmit: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const blocked = disabled || !exitAction.canSubmit;
  const isDelete = exitAction.label === "Delete Alliance";
  const confirmLabel = isDelete ? "Confirm Delete" : "Confirm Leave";

  return (
    <div className="grid gap-2">
      {confirming && !blocked ? (
        <div className="rounded border border-red-300/25 bg-red-950/20 p-3">
          <p className="text-sm font-semibold text-red-50">{exitAction.label}?</p>
          <p className="mt-1 text-xs text-red-100/80">
            {isDelete ? "This removes the alliance after the wallet transaction confirms." : "This removes your wallet from the alliance after the wallet transaction confirms."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="inline-flex items-center justify-center gap-2 rounded border border-red-300/30 px-3 py-2 text-sm font-semibold text-red-100 hover:bg-red-300/10 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled}
              onClick={() => {
                setConfirming(false);
                onSubmit();
              }}
              type="button"
            >
              {isDelete ? <Trash2 size={15} /> : <LogOut size={15} />}
              {confirmLabel}
            </button>
            <button
              className="inline-flex items-center justify-center gap-2 rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10"
              onClick={() => setConfirming(false)}
              type="button"
            >
              <X size={15} />
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="inline-flex items-center justify-center gap-2 rounded border border-red-300/30 px-3 py-2 text-sm font-semibold text-red-100 hover:bg-red-300/10 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={blocked}
          onClick={() => setConfirming(true)}
          type="button"
          title={exitAction.reason ?? exitAction.label}
        >
          {isDelete ? <Trash2 size={15} /> : <LogOut size={15} />}
          {exitAction.label}
        </button>
      )}
      {exitAction.reason ? (
        <p className="rounded border border-amber-300/20 bg-amber-300/10 px-2 py-1.5 text-xs text-amber-100">{exitAction.reason}</p>
      ) : null}
    </div>
  );
}

export const AllianceExitActionPanel = AllianceExitActionButton;

function RosterSection({
  canManageMembers,
  disabled,
  exitAction,
  isOwner,
  roster,
  viewer,
  onBatchKick,
  onBatchSetRole,
  onKick,
  onLeaveAlliance,
  onOpenPlayer,
  onSetRole,
  onTransferOwnership,
}: {
  canManageMembers: boolean;
  disabled: boolean;
  exitAction: { canSubmit: boolean; label: "Leave Alliance" | "Delete Alliance"; reason: string | null };
  isOwner: boolean;
  roster: RosterGroups;
  viewer?: string | undefined;
  onBatchKick: (playerAddresses: string[]) => void;
  onBatchSetRole: (playerAddresses: string[], role: "member" | "officer") => void;
  onKick: (playerAddress: string) => void;
  onLeaveAlliance: () => void;
  onOpenPlayer: (playerAddress: string) => void;
  onSetRole: (playerAddress: string, role: "member" | "officer") => void;
  onTransferOwnership: (playerAddress: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <RosterList
        canManageMembers={canManageMembers}
        disabled={disabled}
        exitAction={exitAction}
        isOwner={isOwner}
        rows={roster.all}
        title="Members"
        viewer={viewer}
        onBatchKick={onBatchKick}
        onBatchSetRole={onBatchSetRole}
        onKick={onKick}
        onLeaveAlliance={onLeaveAlliance}
        onOpenPlayer={onOpenPlayer}
        onSetRole={onSetRole}
        onTransferOwnership={onTransferOwnership}
      />
    </div>
  );
}

function RosterList({
  canManageMembers,
  disabled,
  exitAction,
  isOwner,
  rows,
  title,
  viewer,
  onBatchKick,
  onBatchSetRole,
  onKick,
  onLeaveAlliance,
  onOpenPlayer,
  onSetRole,
  onTransferOwnership,
}: {
  canManageMembers: boolean;
  disabled: boolean;
  exitAction: { canSubmit: boolean; label: "Leave Alliance" | "Delete Alliance"; reason: string | null };
  isOwner: boolean;
  rows: RosterMember[];
  title: string;
  viewer?: string | undefined;
  onBatchKick: (playerAddresses: string[]) => void;
  onBatchSetRole: (playerAddresses: string[], role: "member" | "officer") => void;
  onKick: (playerAddress: string) => void;
  onLeaveAlliance: () => void;
  onOpenPlayer: (playerAddress: string) => void;
  onSetRole: (playerAddress: string, role: "member" | "officer") => void;
  onTransferOwnership: (playerAddress: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const sortedRows = useMemo(() => sortedRosterMembers(rows), [rows]);
  const clampedPage = clampRosterPage(page, sortedRows.length);
  const pageCount = rosterPageCount(sortedRows.length);
  const visibleRows = rosterPageRows(sortedRows, clampedPage);
  const selectableRows = useMemo(
    () => sortedRows.filter((member) => canSelectAllianceRosterMember({ canManageMembers, isOwner, member, viewer })),
    [canManageMembers, isOwner, sortedRows, viewer]
  );
  const selectedRows = useMemo(
    () => sortedRows.filter((member) => selected.has(member.address.toLowerCase())),
    [selected, sortedRows]
  );
  const visibleSelectableAddresses = useMemo(
    () => visibleRows
      .filter((member) => canSelectAllianceRosterMember({ canManageMembers, isOwner, member, viewer }))
      .map((member) => member.address.toLowerCase()),
    [canManageMembers, isOwner, visibleRows, viewer]
  );
  const selectedRemovableAddresses = selectedRows
    .filter((member) => canRemoveAllianceRosterMember({ canManageMembers, isOwner, member, viewer }))
    .map((member) => member.address);
  const selectedPromotableAddresses = selectedRows
    .filter((member) => isOwner && member.role === "member")
    .map((member) => member.address);
  const selectedDemotableAddresses = selectedRows
    .filter((member) => isOwner && member.role === "officer")
    .map((member) => member.address);

  useEffect(() => {
    setPage((current) => clampRosterPage(current, sortedRows.length));
  }, [sortedRows.length]);

  useEffect(() => {
    const valid = new Set(selectableRows.map((member) => member.address.toLowerCase()));
    setSelected((current) => {
      const next = new Set([...current].filter((address) => valid.has(address)));
      return next.size === current.size ? current : next;
    });
  }, [selectableRows]);

  function toggleSelected(address: string): void {
    const key = address.toLowerCase();
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function selectAddresses(addresses: string[]): void {
    setSelected((current) => {
      const next = new Set(current);
      for (const address of addresses) next.add(address.toLowerCase());
      return next;
    });
  }

  return (
    <div className="rounded border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</h3>
        <span className="text-xs text-slate-500">{sortedRows.length}</span>
      </div>
      {sortedRows.length ? (
        <div className="mt-2 grid gap-1.5">
          {canManageMembers && selectableRows.length > 0 ? (
            <RosterBatchActions
              disabled={disabled}
              pageSelectableCount={visibleSelectableAddresses.length}
              selectedCount={selected.size}
              selectedDemotableCount={selectedDemotableAddresses.length}
              selectedPromotableCount={selectedPromotableAddresses.length}
              selectedRemovableCount={selectedRemovableAddresses.length}
              totalSelectableCount={selectableRows.length}
              onBatchKick={() => onBatchKick(selectedRemovableAddresses)}
              onBatchSetRole={onBatchSetRole}
              onClear={() => setSelected(new Set())}
              onSelectAll={() => selectAddresses(selectableRows.map((member) => member.address))}
              onSelectPage={() => selectAddresses(visibleSelectableAddresses)}
              promotableAddresses={selectedPromotableAddresses}
              demotableAddresses={selectedDemotableAddresses}
            />
          ) : null}
          {visibleRows.map((member) => (
            <MemberRow
              canManageMembers={canManageMembers && selectableRows.length > 0}
              disabled={disabled}
              isOwner={isOwner}
              key={member.address}
              member={member}
              selectable={canSelectAllianceRosterMember({ canManageMembers, isOwner, member, viewer })}
              selected={selected.has(member.address.toLowerCase())}
              viewer={viewer}
              onKick={onKick}
              onOpenPlayer={onOpenPlayer}
              onSetRole={onSetRole}
              onToggleSelected={toggleSelected}
              onTransferOwnership={onTransferOwnership}
            />
          ))}
          {pageCount > 1 ? (
            <RosterPagination
              page={clampedPage}
              pageCount={pageCount}
              total={sortedRows.length}
              onNext={() => setPage((current) => Math.min(pageCount, current + 1))}
              onPrevious={() => setPage((current) => Math.max(1, current - 1))}
            />
          ) : null}
          <AllianceMemberActions
            disabled={disabled}
            exitAction={exitAction}
            onLeaveAlliance={onLeaveAlliance}
          />
        </div>
      ) : (
        <div className="mt-2 grid gap-3">
          <p className="text-sm text-slate-400">No {title.toLowerCase()} found.</p>
          <AllianceMemberActions
            disabled={disabled}
            exitAction={exitAction}
            onLeaveAlliance={onLeaveAlliance}
          />
        </div>
      )}
    </div>
  );
}

export function AllianceMemberActions({
  canManageMembers,
  disabled,
  exitAction,
  inviteAddress,
  inviteFormOpen,
  onInvite,
  onLeaveAlliance,
  onSetInviteAddress,
  onSetInviteFormOpen,
}: {
  canManageMembers?: boolean;
  disabled: boolean;
  exitAction: { canSubmit: boolean; label: "Leave Alliance" | "Delete Alliance"; reason: string | null };
  inviteAddress?: string;
  inviteFormOpen?: boolean;
  onInvite?: (playerAddress: string) => void;
  onLeaveAlliance: () => void;
  onSetInviteAddress?: (value: string) => void;
  onSetInviteFormOpen?: (value: boolean) => void;
}) {
  const showInvite = Boolean(canManageMembers && onInvite && onSetInviteAddress && onSetInviteFormOpen);
  const showExit = exitAction.label !== "Delete Alliance";
  if (!showInvite && !showExit) return null;

  return (
    <div className="mt-2 border-t border-white/10 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {showInvite ? (
          <button
            className="inline-flex items-center justify-center gap-2 rounded border border-cyan-300/25 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onClick={() => onSetInviteFormOpen?.(!inviteFormOpen)}
            title={inviteFormOpen ? "Close member invite form" : "Invite alliance member"}
            type="button"
          >
            {inviteFormOpen ? <X size={15} /> : <UserPlus size={15} />}
            {inviteFormOpen ? "Close Invite" : "Invite Member"}
          </button>
        ) : null}
        {showExit ? (
          <AllianceExitActionButton
            disabled={disabled}
            exitAction={exitAction}
            onSubmit={onLeaveAlliance}
          />
        ) : null}
      </div>
      {showInvite && inviteFormOpen ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <TextField label="Wallet" value={inviteAddress ?? ""} onInput={(value) => onSetInviteAddress?.(value)} placeholder="0x..." />
          <button
            className="inline-flex items-center justify-center gap-2 self-end rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || !inviteAddress?.trim()}
            onClick={() => {
              if (inviteAddress?.trim()) onInvite?.(inviteAddress.trim());
            }}
            type="button"
          >
            <UserPlus size={15} />
            Send Invite
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function rosterPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / allianceRosterPageSize));
}

export function clampRosterPage(page: number, total: number): number {
  return Math.min(Math.max(1, page), rosterPageCount(total));
}

export function rosterPageRows<T>(rows: T[], page: number): T[] {
  const clampedPage = clampRosterPage(page, rows.length);
  const start = (clampedPage - 1) * allianceRosterPageSize;
  return rows.slice(start, start + allianceRosterPageSize);
}

export function sortedAllianceDirectory<T extends Pick<DirectoryEntry, "allianceId" | "memberCount" | "name" | "totalMemberScore">>(alliances: T[]): T[] {
  return [...alliances].sort((left, right) => {
    const scoreDelta = scoreValue(right.totalMemberScore) - scoreValue(left.totalMemberScore);
    if (scoreDelta !== 0n) return scoreDelta > 0n ? 1 : -1;
    const memberDelta = right.memberCount - left.memberCount;
    if (memberDelta !== 0) return memberDelta;
    const nameDelta = left.name.localeCompare(right.name);
    if (nameDelta !== 0) return nameDelta;
    return compareNumericStrings(left.allianceId, right.allianceId);
  });
}

export function directoryPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / allianceDirectoryPageSize));
}

export function clampDirectoryPage(page: number, total: number): number {
  return Math.min(Math.max(1, page), directoryPageCount(total));
}

export function directoryPageRows<T>(rows: T[], page: number): T[] {
  const clampedPage = clampDirectoryPage(page, rows.length);
  const start = (clampedPage - 1) * allianceDirectoryPageSize;
  return rows.slice(start, start + allianceDirectoryPageSize);
}

export function canSelectAllianceRosterMember({
  canManageMembers,
  isOwner,
  member,
  viewer,
}: {
  canManageMembers: boolean;
  isOwner: boolean;
  member: Pick<RosterMember, "address" | "role">;
  viewer?: string | undefined;
}): boolean {
  if (!canManageMembers) return false;
  const isViewer = viewer?.toLowerCase() === member.address.toLowerCase();
  if (isViewer || member.role === "owner") return false;
  if (isOwner) return member.role === "member" || member.role === "officer";
  return member.role === "member";
}

export function canRemoveAllianceRosterMember({
  canManageMembers,
  isOwner,
  member,
  viewer,
}: {
  canManageMembers: boolean;
  isOwner: boolean;
  member: Pick<RosterMember, "address" | "role">;
  viewer?: string | undefined;
}): boolean {
  if (!canSelectAllianceRosterMember({ canManageMembers, isOwner, member, viewer })) return false;
  return member.role === "member" || (isOwner && member.role === "officer");
}

export function RosterBatchActions({
  demotableAddresses,
  disabled,
  onBatchKick,
  onBatchSetRole,
  onClear,
  onSelectAll,
  onSelectPage,
  pageSelectableCount,
  promotableAddresses,
  selectedCount,
  selectedDemotableCount,
  selectedPromotableCount,
  selectedRemovableCount,
  totalSelectableCount,
}: {
  demotableAddresses: string[];
  disabled: boolean;
  onBatchKick: () => void;
  onBatchSetRole: (playerAddresses: string[], role: "member" | "officer") => void;
  onClear: () => void;
  onSelectAll: () => void;
  onSelectPage: () => void;
  pageSelectableCount: number;
  promotableAddresses: string[];
  selectedCount: number;
  selectedDemotableCount: number;
  selectedPromotableCount: number;
  selectedRemovableCount: number;
  totalSelectableCount: number;
}) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  useEffect(() => {
    if (selectedRemovableCount === 0) setConfirmingRemove(false);
  }, [selectedRemovableCount]);

  return (
    <div className="rounded border border-cyan-300/20 bg-cyan-300/[0.06] p-2">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <span className="text-xs font-semibold text-cyan-100">
          {selectedCount} selected / {totalSelectableCount} manageable
        </span>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded border border-white/10 px-3 py-2 sm:px-2 sm:py-1 text-xs font-semibold text-slate-100 disabled:opacity-50"
            disabled={disabled || pageSelectableCount === 0}
            onClick={onSelectPage}
            type="button"
          >
            Select Page
          </button>
          <button
            className="rounded border border-white/10 px-3 py-2 sm:px-2 sm:py-1 text-xs font-semibold text-slate-100 disabled:opacity-50"
            disabled={disabled || totalSelectableCount === 0}
            onClick={onSelectAll}
            type="button"
          >
            Select All
          </button>
          <button
            className="rounded border border-white/10 px-3 py-2 sm:px-2 sm:py-1 text-xs font-semibold text-slate-100 disabled:opacity-50"
            disabled={disabled || selectedCount === 0}
            onClick={onClear}
            type="button"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 border-t border-white/10 pt-2">
        <button
          className="rounded border border-white/10 px-3 py-2 sm:px-2 sm:py-1 text-xs font-semibold text-slate-100 disabled:opacity-50"
          disabled={disabled || selectedPromotableCount === 0}
          onClick={() => onBatchSetRole(promotableAddresses, "officer")}
          type="button"
        >
          Make Officer ({selectedPromotableCount})
        </button>
        <button
          className="rounded border border-white/10 px-3 py-2 sm:px-2 sm:py-1 text-xs font-semibold text-slate-100 disabled:opacity-50"
          disabled={disabled || selectedDemotableCount === 0}
          onClick={() => onBatchSetRole(demotableAddresses, "member")}
          type="button"
        >
          Make Member ({selectedDemotableCount})
        </button>
        {confirmingRemove ? (
          <>
            <button
              className="rounded border border-red-300/40 px-3 py-2 sm:px-2 sm:py-1 text-xs font-semibold text-red-100 disabled:opacity-50"
              disabled={disabled || selectedRemovableCount === 0}
              onClick={() => {
                setConfirmingRemove(false);
                onBatchKick();
              }}
              type="button"
            >
              Confirm Remove ({selectedRemovableCount})
            </button>
            <button
              className="rounded border border-white/10 px-3 py-2 sm:px-2 sm:py-1 text-xs font-semibold text-slate-100"
              onClick={() => setConfirmingRemove(false)}
              type="button"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            className="rounded border border-red-300/30 px-3 py-2 sm:px-2 sm:py-1 text-xs font-semibold text-red-100 disabled:opacity-50"
            disabled={disabled || selectedRemovableCount === 0}
            onClick={() => setConfirmingRemove(true)}
            type="button"
          >
            Remove ({selectedRemovableCount})
          </button>
        )}
      </div>
    </div>
  );
}

function RosterPagination({
  onNext,
  onPrevious,
  page,
  pageCount,
  total,
}: {
  onNext: () => void;
  onPrevious: () => void;
  page: number;
  pageCount: number;
  total: number;
}) {
  const first = (page - 1) * allianceRosterPageSize + 1;
  const last = Math.min(page * allianceRosterPageSize, total);

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
      <span>{first}-{last} of {total}</span>
      <div className="flex items-center gap-2">
        <button
          className="rounded border border-white/10 px-3 py-2 sm:px-2 sm:py-1 font-semibold text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={page <= 1}
          onClick={onPrevious}
          type="button"
        >
          Previous
        </button>
        <span>Page {page} of {pageCount}</span>
        <button
          className="rounded border border-white/10 px-3 py-2 sm:px-2 sm:py-1 font-semibold text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={page >= pageCount}
          onClick={onNext}
          type="button"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function DirectoryPagination({
  onNext,
  onPrevious,
  page,
  pageCount,
  total,
}: {
  onNext: () => void;
  onPrevious: () => void;
  page: number;
  pageCount: number;
  total: number;
}) {
  const first = (page - 1) * allianceDirectoryPageSize + 1;
  const last = Math.min(page * allianceDirectoryPageSize, total);

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
      <span>{first}-{last} of {total}</span>
      <div className="flex items-center gap-2">
        <button
          className="rounded border border-white/10 px-2 py-1 font-semibold text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={page <= 1}
          onClick={onPrevious}
          type="button"
        >
          Previous
        </button>
        <span>Page {page} of {pageCount}</span>
        <button
          className="rounded border border-white/10 px-2 py-1 font-semibold text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={page >= pageCount}
          onClick={onNext}
          type="button"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function MemberRow({
  canManageMembers,
  disabled,
  isOwner,
  member,
  selectable,
  selected,
  viewer,
  onKick,
  onOpenPlayer,
  onSetRole,
  onToggleSelected,
  onTransferOwnership,
}: {
  canManageMembers: boolean;
  disabled: boolean;
  isOwner: boolean;
  member: RosterMember;
  selectable: boolean;
  selected: boolean;
  viewer?: string | undefined;
  onKick: (playerAddress: string) => void;
  onOpenPlayer: (playerAddress: string) => void;
  onSetRole: (playerAddress: string, role: "member" | "officer") => void;
  onToggleSelected: (playerAddress: string) => void;
  onTransferOwnership: (playerAddress: string) => void;
}) {
  const [confirmingTransfer, setConfirmingTransfer] = useState(false);
  const isViewer = viewer?.toLowerCase() === member.address.toLowerCase();
  const canKick = canManageMembers && member.role === "member";
  const ownerCanChangeRole = isOwner && member.role !== "owner";
  const canTransferOwnership = canTransferAllianceOwnership(member, isOwner, isViewer);
  const rowTone = memberRowTone(member, isViewer);

  return (
    <div className={`grid gap-2 rounded border px-2 py-2 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center ${rowTone}`}>
      {canManageMembers ? (
        <label className="mt-1 inline-flex cursor-pointer md:mt-0">
          <input
            aria-label={`Select ${playerLabel(member.displayName, member.address)}`}
            checked={selected}
            className="h-5 w-5 accent-cyan-300"
            disabled={disabled || !selectable}
            onChange={() => onToggleSelected(member.address)}
            type="checkbox"
          />
        </label>
      ) : null}
      <PlayerRowInfo
        address={member.address}
        badge={roleLabel(member.role)}
        displayName={member.displayName}
        icon={member.role === "owner" ? <Crown size={14} className="text-amber-200" /> : <UserRound size={14} className="text-slate-500" />}
        timestamp={member.joinedAt}
        timestampLabel="Joined"
        totalScore={member.totalScore}
        onOpenPlayer={onOpenPlayer}
      />
      {canManageMembers ? (
        <div className="flex flex-wrap gap-2 md:justify-end">
          {ownerCanChangeRole && member.role === "member" ? (
            <button className="rounded border border-white/10 px-3 py-2 sm:px-2 sm:py-1 text-xs font-semibold text-slate-100 disabled:opacity-50" disabled={disabled} onClick={() => onSetRole(member.address, "officer")} type="button">
              Make Officer
            </button>
          ) : null}
          {ownerCanChangeRole && member.role === "officer" ? (
            <button className="rounded border border-white/10 px-3 py-2 sm:px-2 sm:py-1 text-xs font-semibold text-slate-100 disabled:opacity-50" disabled={disabled} onClick={() => onSetRole(member.address, "member")} type="button">
              Make Member
            </button>
          ) : null}
          {canTransferOwnership ? (
            confirmingTransfer ? (
              <>
                <button
                  className="rounded border border-amber-300/40 px-3 py-2 sm:px-2 sm:py-1 text-xs font-semibold text-amber-100 disabled:opacity-50"
                  disabled={disabled}
                  onClick={() => {
                    setConfirmingTransfer(false);
                    onTransferOwnership(member.address);
                  }}
                  type="button"
                >
                  Confirm Transfer
                </button>
                <button
                  className="rounded border border-white/10 px-3 py-2 sm:px-2 sm:py-1 text-xs font-semibold text-slate-100 hover:bg-white/10"
                  onClick={() => setConfirmingTransfer(false)}
                  type="button"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="rounded border border-amber-300/30 px-3 py-2 sm:px-2 sm:py-1 text-xs font-semibold text-amber-100 disabled:opacity-50"
                disabled={disabled}
                onClick={() => setConfirmingTransfer(true)}
                title="Hand the owner role to this officer"
                type="button"
              >
                Transfer Ownership
              </button>
            )
          ) : null}
          {(canKick || (isOwner && member.role === "officer")) && !isViewer ? (
            <button className="rounded border border-red-300/30 px-3 py-2 sm:px-2 sm:py-1 text-xs font-semibold text-red-100 disabled:opacity-50" disabled={disabled} onClick={() => onKick(member.address)} type="button">
              Remove
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PlayerProfilePanel({ profile, onClose }: { profile: PlayerProfileState; onClose: () => void }) {
  if (profile.status === "idle") {
    return (
      <Panel title="Player Profile" action={<SectionIcon icon={UserRound} />}>
        <p className="text-sm text-slate-400">Select a roster member or owner to inspect public player state.</p>
      </Panel>
    );
  }

  const wallet = profile.wallet;

  return (
    <Panel
      title="Player Profile"
      action={(
        <button className="rounded border border-white/10 p-1 text-slate-300 hover:bg-white/10" onClick={onClose} type="button" title="Close profile">
          <X size={15} />
        </button>
      )}
    >
      <div className="grid gap-3">
        <div>
          <p className="font-mono text-sm text-white">{shortAddress(wallet)}</p>
          <p className="mt-1 break-all text-xs text-slate-500">{wallet}</p>
        </div>
        {profile.status === "loading" ? <VeydriftLoader label="Loading player profile" variant="inline" /> : null}
        {profile.status === "error" ? (
          isGameUnavailableMessage(profile.label) ? <GameUnavailableNotice /> : <Notice tone="error">{profile.label}</Notice>
        ) : null}
        {profile.status === "loaded" ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Planets" value={String(profile.planets?.planets.length ?? 0)} />
              <MiniStat label="Score" value={formatScore(profile.highscore?.totalUserScore ?? profile.highscore?.score.total)} />
            </div>
            {profile.planets?.planets.length ? (
              <div className="grid gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Planets</h4>
                {profile.planets.planets.slice(0, 5).map((planet) => (
                  <div className="rounded border border-white/10 bg-black/20 px-3 py-2" key={planet.planetId}>
                    <p className="text-sm font-semibold text-white">{planet.name || `Planet #${planet.planetId}`}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      [{planet.galaxy}:{planet.system}:{planet.position}] / {planet.fieldsUsed}/{planet.fieldsCapacity} fields
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-400">
                No indexed planets are available for this wallet yet.
              </p>
            )}
          </>
        ) : null}
      </div>
    </Panel>
  );
}

function Panel({ action, children, title }: { action?: ComponentChildren; children: ComponentChildren; title: string }) {
  return (
    <section className="min-w-0 break-words rounded border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SectionIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded border border-white/10 bg-black/20 text-slate-300">
      <Icon size={15} />
    </span>
  );
}

function RolePill({ role }: { role: AllianceRole }) {
  return (
    <span className="rounded border border-white/10 px-2 py-1 text-xs font-semibold capitalize text-slate-300">
      {roleLabel(role)}
    </span>
  );
}

function AllianceControlTab({
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
      aria-selected={active}
      className={`-mb-px inline-flex h-9 items-center justify-center gap-2 border-b-2 px-3 text-xs font-semibold transition ${
        active
          ? "border-cyan-300 bg-cyan-300/[0.06] text-cyan-100"
          : "border-transparent text-slate-400 hover:border-white/20 hover:text-slate-200"
      }`}
      onClick={onClick}
      role="tab"
      type="button"
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

const allianceManagementPrimaryActionClass = "inline-flex h-10 items-center justify-center gap-2 rounded border border-cyan-300/30 bg-cyan-300/10 px-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-slate-500";
const allianceManagementSecondaryActionClass = "inline-flex h-10 items-center justify-center gap-2 rounded border border-white/10 bg-black/20 px-3 text-sm font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:text-slate-500";

function AllianceManagementPanel({
  children,
  description,
}: {
  children: ComponentChildren;
  description: ComponentChildren;
}) {
  return (
    <div className="rounded border border-cyan-300/15 bg-cyan-300/[0.04] p-3">
      <div className="text-xs text-slate-400">{description}</div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function AllianceTreasuryExplanation() {
  return (
    <div className="grid gap-1.5">
      <p className="flex items-start gap-2 leading-relaxed text-slate-400">
        <Mail className="mt-0.5 shrink-0 text-cyan-200" size={14} />
        <span>Redeemed private invites add 2% of that commander&apos;s production to the alliance.</span>
      </p>
      <p className="flex items-start gap-2 leading-relaxed text-slate-400">
        <Shield className="mt-0.5 shrink-0 text-cyan-200" size={14} />
        <span>Officers and owners can move resources instantly to a planet with a built Rift.</span>
      </p>
    </div>
  );
}

function AlliancePrivateInviteExplanation() {
  return (
    <ul className="grid gap-1.5 text-slate-400">
      <li className="flex items-start gap-2 leading-relaxed">
        <Users className="mt-0.5 shrink-0 text-cyan-200" size={14} />
        <span>A redeemed invite adds 2% of the invitee&apos;s production to the alliance while they are a member; the invitee loses nothing.</span>
      </li>
      <li className="flex items-start gap-2 leading-relaxed">
        <UserPlus className="mt-0.5 shrink-0 text-cyan-200" size={14} />
        <span>If an invitee leaves and rejoins the alliance, their production contribution resumes.</span>
      </li>
      <li className="flex items-start gap-2 leading-relaxed">
        <Crown className="mt-0.5 shrink-0 text-cyan-200" size={14} />
        <span>Any alliance member can buy a private invite for 0.006 ETH.</span>
      </li>
      <li className="flex items-start gap-2 leading-relaxed">
        <Shield className="mt-0.5 shrink-0 text-cyan-200" size={14} />
        <span>Only alliance officers and owners can view or recover invite links.</span>
      </li>
      <li className="flex items-start gap-2 leading-relaxed">
        <Mail className="mt-0.5 shrink-0 text-cyan-200" size={14} />
        <span>Each link is unique and single-use; share it only with its intended invitee.</span>
      </li>
      <li className="flex items-start gap-2 leading-relaxed">
        <Check className="mt-0.5 shrink-0 text-cyan-200" size={14} />
        <span>The invited commander joins the game for free and starts with 2× resources.</span>
      </li>
    </ul>
  );
}

function AllianceTreasuryResourceField({
  label,
  max,
  onChange,
  value,
}: {
  label: "metal" | "crystal" | "deuterium";
  max?: string | undefined;
  onChange: (value: string) => void;
  value: string;
}) {
  const maxAvailable = (() => {
    if (max === undefined) return false;
    try {
      return BigInt(max) > 0n;
    } catch {
      return false;
    }
  })();
  const normalizedValue = value || "0";
  const availableLabel = max === undefined ? "Unavailable" : formatAllianceResource(max);
  return (
    <label className="grid min-w-0 gap-1 text-xs text-slate-300">
      <span className="flex min-h-6 items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="capitalize">{label}</span>
          <span className="ml-2 font-mono text-[11px] text-slate-500">{availableLabel}</span>
        </span>
        <button
          aria-label={`Set ${label} withdrawal to maximum (${formatAllianceResource(max)})`}
          className="rounded border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-300/15 disabled:cursor-default disabled:opacity-40"
          disabled={!maxAvailable || normalizedValue === max}
          onClick={(event) => {
            event.preventDefault();
            if (maxAvailable && max !== undefined) onChange(max);
          }}
          type="button"
        >
          Max
        </button>
      </span>
      <input
        className="h-10 w-full rounded border border-white/10 bg-black/30 px-2 text-right font-mono text-sm text-white outline-none focus:border-cyan-300/60"
        inputMode="numeric"
        onInput={(event) => onChange(event.currentTarget.value.replace(/\D/g, ""))}
        placeholder="0"
        value={value}
      />
    </label>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/20 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold capitalize text-white">{value}</p>
    </div>
  );
}

function TextField({ label, onInput, placeholder, value }: {
  label: string;
  onInput: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <input
        className="mt-1 w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50"
        onInput={(event) => onInput(event.currentTarget.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function TextArea({ label, onInput, placeholder, value }: {
  label: string;
  onInput: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <textarea
        className="mt-1 min-h-24 w-full resize-y rounded border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50"
        onInput={(event) => onInput(event.currentTarget.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function Notice({ children, tone = "info" }: { children: ComponentChildren; tone?: "error" | "info" }) {
  return (
    <div className={`notice-enter rounded border px-3 py-2 text-sm ${tone === "error" ? "border-red-400/30 bg-red-400/10 text-red-100" : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100"}`}>
      {children}
    </div>
  );
}

export function allianceDisplayName(alliance: Pick<DirectoryEntry, "tag" | "name">): string {
  return `${alliance.tag} - ${alliance.name}`;
}

export function memberCountLabel(count: number): string {
  return count === 1 ? "1 member" : `${count} members`;
}

export function buildAllianceRoster(members: RosterMember[], owner?: string | undefined): RosterGroups {
  const byAddress = new Map<string, RosterMember>();
  for (const member of members) {
    byAddress.set(member.address.toLowerCase(), member);
  }
  if (owner) {
    const key = owner.toLowerCase();
    const existing = byAddress.get(key);
    byAddress.set(key, {
      address: existing?.address ?? owner,
      displayName: existing?.displayName ?? null,
      joinedAt: existing?.joinedAt ?? "0",
      role: "owner",
      ...(existing?.totalScore ? { totalScore: existing.totalScore } : {}),
    });
  }

  const all = sortedRosterMembers([...byAddress.values()]);
  return {
    all,
    officers: all.filter((member) => member.role === "owner" || member.role === "officer"),
    members: all.filter((member) => member.role === "member"),
  };
}

export function sortedRosterMembers<T extends Pick<RosterMember, "address" | "role" | "totalScore">>(members: T[]): T[] {
  return [...members].sort(compareRosterMembers);
}

export function findAllianceEntry(
  directory: DirectoryEntry[],
  allianceId: string | null | undefined,
  currentAlliance: AllianceEntry | null = null
): AllianceEntry | null {
  if (!allianceId) return currentAlliance;
  if (currentAlliance?.allianceId === allianceId) return currentAlliance;
  const entry = directory.find((alliance) => alliance.allianceId === allianceId);
  return entry ? { ...entry, rosterAvailable: false } : null;
}

export function currentAllianceEntry(allianceState: ChainAllianceState | null, rosterCount: number): AllianceEntry | null {
  const profile = allianceState?.profile;
  const allianceId = allianceState?.membership.allianceId;
  if (!profile || !allianceId || allianceId === "0") return null;
  const directoryEntry = allianceState.directory.find((alliance) => alliance.allianceId === allianceId);
  return {
    active: profile.active,
    allianceId,
    createdAt: profile.createdAt,
    description: profile.description,
    memberCount: Math.max(profile.memberCount, rosterCount),
    name: profile.name,
    owner: profile.owner,
    ownerDisplayName: profile.ownerDisplayName ?? null,
    rosterAvailable: true,
    tag: profile.tag,
    bonusBalance: profile.bonusBalance ?? directoryEntry?.bonusBalance ?? null,
    privateInviteStats: profile.privateInviteStats ?? directoryEntry?.privateInviteStats ?? null,
    ...(profile.totalMemberScore ? { totalMemberScore: profile.totalMemberScore } : {}),
  };
}

function compareRosterMembers<T extends Pick<RosterMember, "address" | "role" | "totalScore">>(left: T, right: T): number {
  const roleOrder: Record<AllianceRole, number> = {
    owner: 0,
    officer: 1,
    member: 2,
    none: 3,
  };
  const roleDelta = roleOrder[left.role] - roleOrder[right.role];
  if (roleDelta !== 0) return roleDelta;
  const scoreDelta = scoreValue(right.totalScore) - scoreValue(left.totalScore);
  if (scoreDelta !== 0n) return scoreDelta > 0n ? 1 : -1;
  return left.address.localeCompare(right.address);
}

function memberRowTone(member: RosterMember, isViewer: boolean): string {
  if (isViewer) return "border-emerald-300/35 bg-emerald-300/[0.10]";
  if (member.role === "owner") return "border-amber-300/35 bg-amber-300/[0.10]";
  if (member.role === "officer") return "border-emerald-300/25 bg-emerald-300/[0.07]";
  return "border-white/10 bg-white/[0.03]";
}

function roleLabel(role: AllianceRole): string {
  if (role === "owner") return "owner";
  if (role === "officer") return "officer";
  if (role === "member") return "member";
  return "none";
}

function playerLabel(displayName: string | null | undefined, wallet: string): string {
  return displayName?.trim() || shortAddress(wallet);
}

function formatScore(value: string | undefined): string {
  if (!value) return "0";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString() : value;
}

function scoreValue(value: string | undefined): bigint {
  try {
    return BigInt(value ?? "0");
  } catch {
    return 0n;
  }
}

function compareNumericStrings(left: string, right: string): number {
  try {
    const delta = BigInt(left) - BigInt(right);
    if (delta < 0n) return -1;
    if (delta > 0n) return 1;
    return 0;
  } catch {
    return left.localeCompare(right);
  }
}
