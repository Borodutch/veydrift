import { Crown, Info, RefreshCw, Shield, UserRound, Users, X } from "lucide-preact";
import type { LucideIcon } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { formatUserTimestamp } from "../timestampFormat";
import type { AllianceRole, ChainAllianceState, HighscoreEntry, WalletPlanetsResponse } from "../walletFlow";
import { fetchWalletPlanets, shortAddress } from "../walletFlow";
import { InlineSyncIndicator, VeydriftLoader } from "./VeydriftLoader";

export const allianceRosterPageSize = 50;

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

type PlayerProfileState =
  | { status: "idle" }
  | { status: "loading"; wallet: string }
  | { status: "loaded"; wallet: string; planets: WalletPlanetsResponse | null; highscore: HighscoreEntry | null }
  | { status: "error"; wallet: string; label: string };

interface AlliancePageProps {
  actionState: AllianceActionState;
  allianceState: ChainAllianceState | null;
  apiBaseUrl?: string | undefined;
  canTransact: boolean;
  error?: string | undefined;
  loading: boolean;
  selectedAllianceId?: string | null | undefined;
  onAcceptInvite: (allianceId: string) => void;
  onApproveJoinRequest: (playerAddress: string) => void;
  onCancelJoinRequest: (allianceId: string) => void;
  onCreate: (tag: string, name: string, description: string) => void;
  onDismissJoinRequest: (playerAddress: string) => void;
  onInvite: (playerAddress: string) => void;
  onJoinRequest: (allianceId: string) => void;
  onKick: (playerAddress: string) => void;
  onLeaveAlliance: () => void;
  onOpenAlliance?: ((allianceId: string) => void) | undefined;
  onOpenPlayer?: ((playerAddress: string) => void) | undefined;
  onRefresh: () => void;
  onSetRole: (playerAddress: string, role: "member" | "officer") => void;
  onUpdateProfile: (tag: string, name: string, description: string) => void;
}

export function AlliancePage({
  actionState,
  allianceState,
  apiBaseUrl,
  canTransact,
  error,
  loading,
  selectedAllianceId,
  onAcceptInvite,
  onApproveJoinRequest,
  onCancelJoinRequest,
  onCreate,
  onDismissJoinRequest,
  onInvite,
  onJoinRequest,
  onKick,
  onLeaveAlliance,
  onOpenAlliance,
  onOpenPlayer,
  onRefresh,
  onSetRole,
  onUpdateProfile,
}: AlliancePageProps) {
  const [tag, setTag] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [profileTag, setProfileTag] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileDescription, setProfileDescription] = useState("");
  const [inviteAddress, setInviteAddress] = useState("");
  const [roleInfoOpen, setRoleInfoOpen] = useState(false);
  const [activeAllianceId, setActiveAllianceId] = useState<string | null>(selectedAllianceId ?? null);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [playerProfile, setPlayerProfile] = useState<PlayerProfileState>({ status: "idle" });

  const profile = allianceState?.profile;
  const role = allianceState?.membership.role ?? "none";
  const currentAllianceId = allianceState?.membership.allianceId ?? "0";
  const isMember = hasAllianceMembership(allianceState);
  const isOwner = role === "owner";
  const canManageMembers = role === "owner" || role === "officer";
  const disabled = !canTransact || loading || actionState.status === "pending";
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
  const initialLoading = shouldShowAllianceInitialLoader({ allianceState, loading });
  const backgroundRefresh = shouldShowAllianceRefreshIndicator({ allianceState, loading });
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
    Promise.allSettled([
      fetchWalletPlanets(apiBaseUrl, selectedPlayer),
      fetchPlayerHighscore(apiBaseUrl, selectedPlayer),
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
      <header className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-white">Alliance</h1>
          <p className="mt-1 text-sm text-slate-400">
            {isMember && profile ? allianceDisplayName(profile) : "Create an alliance or scan the public directory."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {backgroundRefresh ? <InlineSyncIndicator label="Refreshing alliance" /> : null}
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-3 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onRefresh}
            type="button"
            disabled={loading}
            title="Refresh alliance state"
          >
            <RefreshCw aria-hidden="true" size={14} />
            Refresh
          </button>
        </div>
      </header>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {allianceState?.allianceAvailable === false ? (
        <Notice>{allianceState.unavailableReason ?? "Alliance contract is not configured."}</Notice>
      ) : null}
      {actionState.status !== "idle" ? <Notice tone={actionState.status === "error" ? "error" : "info"}>{actionState.label}</Notice> : null}

      {initialLoading ? (
        <VeydriftLoader label="Loading alliance data" />
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-4">
            <MyAllianceSection
              canManageMembers={canManageMembers}
              currentAlliance={currentAlliance}
              disabled={disabled}
              exitAction={exitAction}
              inviteAddress={inviteAddress}
              isMember={isMember}
              isOwner={isOwner}
              profileDescription={profileDescription}
              profileName={profileName}
              profileTag={profileTag}
              role={role}
              roleInfoOpen={roleInfoOpen}
              roster={roster}
              tag={tag}
              name={name}
              description={description}
              viewer={allianceState?.wallet}
              onCreate={onCreate}
              onInvite={onInvite}
              onKick={onKick}
              onLeaveAlliance={onLeaveAlliance}
              onOpenAlliance={onOpenAlliance}
              onOpenPlayer={openPlayer}
              onSetDescription={setDescription}
              onSetInviteAddress={setInviteAddress}
              onSetName={setName}
              onSetProfileDescription={setProfileDescription}
              onSetProfileName={setProfileName}
              onSetProfileTag={setProfileTag}
              onSetRole={onSetRole}
              onSetRoleInfoOpen={setRoleInfoOpen}
              onSetTag={setTag}
              onUpdateProfile={onUpdateProfile}
            />

            <DirectorySection
              alliances={directory}
              currentAllianceId={isMember ? currentAllianceId : null}
              disabled={disabled}
              pendingJoinRequests={allianceState?.pendingJoinRequests ?? []}
              selectedAllianceId={selectedAlliance?.allianceId ?? null}
              onCancelJoinRequest={onCancelJoinRequest}
              onJoinRequest={onJoinRequest}
              onOpenAlliance={openAlliance}
              onSelectAlliance={setActiveAllianceId}
            />
          </div>

          <aside className="grid min-w-0 gap-4 content-start">
            <AllianceDetailsPanel
              alliance={selectedAlliance}
              isCurrentAlliance={Boolean(selectedAlliance && selectedAlliance.allianceId === currentAllianceId)}
              roster={selectedAlliance?.allianceId === currentAllianceId ? roster : undefined}
              onOpenPlayer={openPlayer}
            />
            <PendingInvites
              allianceState={allianceState}
              disabled={disabled}
              invites={allianceState?.pendingInvites ?? []}
              directory={directory}
              onAcceptInvite={onAcceptInvite}
            />
            {canManageMembers ? (
              <JoinRequests
                allianceState={allianceState}
                disabled={disabled}
                requests={allianceState?.allianceJoinRequests ?? []}
                onApproveJoinRequest={onApproveJoinRequest}
                onDismissJoinRequest={onDismissJoinRequest}
                onOpenPlayer={openPlayer}
              />
            ) : null}
            {!onOpenPlayer ? (
              <PlayerProfilePanel
                profile={playerProfile}
                onClose={() => setSelectedPlayer(null)}
              />
            ) : null}
          </aside>
        </div>
      )}
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

export function shouldShowAllianceRefreshIndicator({
  allianceState,
  loading,
}: {
  allianceState: ChainAllianceState | null;
  loading: boolean;
}): boolean {
  return loading && Boolean(allianceState);
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

function MyAllianceSection({
  canManageMembers,
  currentAlliance,
  disabled,
  exitAction,
  inviteAddress,
  isMember,
  isOwner,
  profileDescription,
  profileName,
  profileTag,
  role,
  roleInfoOpen,
  roster,
  tag,
  name,
  description,
  viewer,
  onCreate,
  onInvite,
  onKick,
  onLeaveAlliance,
  onOpenAlliance,
  onOpenPlayer,
  onSetDescription,
  onSetInviteAddress,
  onSetName,
  onSetProfileDescription,
  onSetProfileName,
  onSetProfileTag,
  onSetRole,
  onSetRoleInfoOpen,
  onSetTag,
  onUpdateProfile,
}: {
  canManageMembers: boolean;
  currentAlliance: AllianceEntry | null;
  disabled: boolean;
  exitAction: { canSubmit: boolean; label: "Leave Alliance" | "Delete Alliance"; reason: string | null };
  inviteAddress: string;
  isMember: boolean;
  isOwner: boolean;
  profileDescription: string;
  profileName: string;
  profileTag: string;
  role: AllianceRole;
  roleInfoOpen: boolean;
  roster: RosterGroups;
  tag: string;
  name: string;
  description: string;
  viewer?: string | undefined;
  onCreate: (tag: string, name: string, description: string) => void;
  onInvite: (playerAddress: string) => void;
  onKick: (playerAddress: string) => void;
  onLeaveAlliance: () => void;
  onOpenAlliance?: ((allianceId: string) => void) | undefined;
  onOpenPlayer: (playerAddress: string) => void;
  onSetDescription: (value: string) => void;
  onSetInviteAddress: (value: string) => void;
  onSetName: (value: string) => void;
  onSetProfileDescription: (value: string) => void;
  onSetProfileName: (value: string) => void;
  onSetProfileTag: (value: string) => void;
  onSetRole: (playerAddress: string, role: "member" | "officer") => void;
  onSetRoleInfoOpen: (value: boolean) => void;
  onSetTag: (value: string) => void;
  onUpdateProfile: (tag: string, name: string, description: string) => void;
}) {
  if (!isMember || !currentAlliance) {
    return (
      <Panel title="My Alliance" action={<SectionIcon icon={Users} />}>
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
          <div className="min-w-0 rounded border border-white/10 bg-black/20 p-3">
            <h3 className="text-sm font-semibold text-white">Create Alliance</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <TextField label="Tag" value={tag} onInput={onSetTag} placeholder="VDFT" />
              <TextField label="Name" value={name} onInput={onSetName} placeholder="Veydrift Union" />
            </div>
            <div className="mt-3">
              <TextArea label="Description" value={description} onInput={onSetDescription} placeholder="Public charter, coordination notes, or Discord link" />
            </div>
            <button
              className="mt-3 rounded bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled || !tag.trim() || !name.trim()}
              onClick={() => onCreate(tag.trim(), name.trim(), description.trim())}
              type="button"
            >
              Create Alliance
            </button>
          </div>
          <div className="min-w-0 break-words rounded border border-white/10 bg-white/[0.03] p-3">
            <h3 className="text-sm font-semibold text-white">Discover Alliances</h3>
            <p className="mt-2 text-sm text-slate-400">
              Browse public alliances below, open details, then request to join from the directory row.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="My Alliance"
      action={(
        <button
          className="inline-flex h-8 items-center gap-1 rounded border border-white/10 px-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
          onClick={() => onSetRoleInfoOpen(!roleInfoOpen)}
          type="button"
        >
          <Info size={14} />
          {roleLabel(role)}
        </button>
      )}
    >
      <div className="grid gap-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
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
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              {currentAlliance.description || "No public alliance description."}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-right sm:min-w-72">
            <MiniStat label="Members" value={String(currentAlliance.memberCount)} />
            <MiniStat label="Officers" value={String(roster.officers.length)} />
            <MiniStat label="Role" value={roleLabel(role)} />
          </div>
        </div>

        {roleInfoOpen ? <RoleInfo role={role} /> : null}

        {isOwner ? (
          <div className="rounded border border-white/10 bg-black/20 p-3">
            <h3 className="text-sm font-semibold text-white">Profile</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <TextField label="Tag" value={profileTag} onInput={onSetProfileTag} placeholder="VDFT" />
              <TextField label="Name" value={profileName} onInput={onSetProfileName} placeholder="Veydrift Union" />
            </div>
            <div className="mt-3">
              <TextArea label="Description" value={profileDescription} onInput={onSetProfileDescription} placeholder="Public alliance description" />
            </div>
            <button
              className="mt-3 rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled || !profileTag.trim() || !profileName.trim()}
              onClick={() => onUpdateProfile(profileTag.trim(), profileName.trim(), profileDescription.trim())}
              type="button"
            >
              Update Profile
            </button>
          </div>
        ) : null}

        {canManageMembers ? (
          <div className="rounded border border-white/10 bg-black/20 p-3">
            <h3 className="text-sm font-semibold text-white">Invite</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <TextField label="Wallet" value={inviteAddress} onInput={onSetInviteAddress} placeholder="0x..." />
              <button
                className="self-end rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled || !inviteAddress.trim()}
                onClick={() => onInvite(inviteAddress.trim())}
                type="button"
              >
                Invite
              </button>
            </div>
          </div>
        ) : null}

        <AllianceExitActionPanel
          disabled={disabled}
          exitAction={exitAction}
          onSubmit={onLeaveAlliance}
        />

        <RosterSection
          canManageMembers={canManageMembers}
          disabled={disabled}
          isOwner={isOwner}
          roster={roster}
          viewer={viewer}
          onKick={onKick}
          onOpenPlayer={onOpenPlayer}
          onSetRole={onSetRole}
        />
      </div>
    </Panel>
  );
}

function DirectorySection({
  alliances,
  currentAllianceId,
  disabled,
  pendingJoinRequests,
  selectedAllianceId,
  onCancelJoinRequest,
  onJoinRequest,
  onOpenAlliance,
  onSelectAlliance,
}: {
  alliances: DirectoryEntry[];
  currentAllianceId: string | null;
  disabled: boolean;
  pendingJoinRequests: ChainAllianceState["pendingJoinRequests"];
  selectedAllianceId: string | null;
  onCancelJoinRequest: (allianceId: string) => void;
  onJoinRequest: (allianceId: string) => void;
  onOpenAlliance?: ((allianceId: string) => void) | undefined;
  onSelectAlliance: (allianceId: string) => void;
}) {
  const pendingIds = new Set(pendingJoinRequests.map((request) => request.allianceId));
  const visibleAlliances = currentAllianceId
    ? alliances.filter((alliance) => alliance.allianceId !== currentAllianceId)
    : alliances;

  return (
    <Panel title="Other Alliances">
      {visibleAlliances.length ? (
        <div className="grid gap-2">
          {visibleAlliances.map((alliance) => {
            const pending = pendingIds.has(alliance.allianceId);
            const selected = selectedAllianceId === alliance.allianceId;
            return (
              <div
                className={`grid gap-3 rounded border p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center ${
                  selected ? "border-cyan-300/35 bg-cyan-300/[0.08]" : "border-white/10 bg-black/20"
                }`}
                key={alliance.allianceId}
              >
                <button
                  className="min-w-0 text-left"
                  onClick={() => onOpenAlliance ? onOpenAlliance(alliance.allianceId) : onSelectAlliance(alliance.allianceId)}
                  type="button"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="rounded border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs font-semibold text-cyan-100">
                      {alliance.tag}
                    </span>
                    <span className="truncate text-sm font-semibold text-white">{alliance.name}</span>
                    <span className="text-xs text-slate-500">#{alliance.allianceId}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-slate-400">{alliance.description || "No public description."}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span>{alliance.memberCount} members</span>
                    <span>Owner {playerLabel(alliance.ownerDisplayName, alliance.owner)}</span>
                    <span>Created {formatUserTimestamp(alliance.createdAt)}</span>
                  </div>
                </button>
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
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-400">No other public alliances found yet.</p>
      )}
    </Panel>
  );
}

function AllianceDetailsPanel({
  alliance,
  isCurrentAlliance,
  roster,
  onOpenPlayer,
}: {
  alliance: AllianceEntry | null;
  isCurrentAlliance: boolean;
  roster?: RosterGroups | undefined;
  onOpenPlayer: (playerAddress: string) => void;
}) {
  return (
    <Panel title="Alliance Details" action={<SectionIcon icon={Shield} />}>
      {alliance ? (
        <div className="grid gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-cyan-300/35 bg-cyan-300/10 px-2 py-1 font-mono text-xs font-semibold text-cyan-100">
                {alliance.tag}
              </span>
              <h3 className="text-sm font-semibold text-white">{alliance.name}</h3>
            </div>
            <p className="mt-2 text-sm text-slate-400">{alliance.description || "No public alliance description."}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Members" value={String(alliance.memberCount)} />
            <MiniStat label="Alliance ID" value={alliance.allianceId} />
          </div>
          {isCurrentAlliance && roster ? (
            <div className="grid gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Roster Preview</h4>
              {roster.all.slice(0, 6).map((member) => (
                <MemberRow
                  canManageMembers={false}
                  disabled={false}
                  isOwner={false}
                  key={member.address}
                  member={member}
                  viewer={undefined}
                  onKick={() => undefined}
                  onOpenPlayer={onOpenPlayer}
                  onSetRole={() => undefined}
                />
              ))}
            </div>
          ) : (
            <>
              <button
                className="rounded border border-white/10 bg-black/20 px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10"
                onClick={() => onOpenPlayer(alliance.owner)}
                type="button"
              >
                Owner <span className="font-mono text-cyan-100">{playerLabel(alliance.ownerDisplayName, alliance.owner)}</span>
              </button>
              <p className="rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-400">
                Full roster is available after joining or from a current-alliance view.
              </p>
            </>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-400">Select an alliance from the directory to inspect its public profile.</p>
      )}
    </Panel>
  );
}

function PendingInvites({
  allianceState,
  directory,
  disabled,
  invites,
  onAcceptInvite,
}: {
  allianceState: ChainAllianceState | null;
  directory: DirectoryEntry[];
  disabled: boolean;
  invites: ChainAllianceState["pendingInvites"];
  onAcceptInvite: (allianceId: string) => void;
}) {
  return (
    <Panel title="Invitations">
      {invites.length ? (
        <div className="grid gap-2">
          {invites.map((invite) => {
            const alliance = directory.find((entry) => entry.allianceId === invite.allianceId);
            const acceptance = allianceInviteAcceptanceState(allianceState, invite);
            return (
              <div className="rounded border border-white/10 bg-black/20 p-3" key={invite.allianceId}>
                <p className="text-sm font-semibold text-white">{alliance ? allianceDisplayName(alliance) : `Alliance #${invite.allianceId}`}</p>
                <p className="mt-1 text-sm text-slate-400">Invited by {playerLabel(invite.inviterDisplayName, invite.inviter)}</p>
                {acceptance.reason ? <p className="mt-2 rounded border border-amber-300/20 bg-amber-300/10 px-2 py-1.5 text-xs text-amber-100">{acceptance.reason}</p> : null}
                <button
                  className="mt-3 w-full rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={disabled || !acceptance.canAccept}
                  onClick={() => onAcceptInvite(invite.allianceId)}
                  type="button"
                >
                  Accept Invite
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-400">No pending invitations.</p>
      )}
    </Panel>
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
                <button className="font-mono text-sm text-white hover:text-cyan-100" onClick={() => onOpenPlayer(request.requester)} type="button">
                  {playerLabel(request.requesterDisplayName, request.requester)}
                </button>
                <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">Requested {formatUserTimestamp(request.requestedAt)}</p>
                {approval.reason ? <p className="mt-2 rounded border border-amber-300/20 bg-amber-300/10 px-2 py-1.5 text-xs text-amber-100">{approval.reason}</p> : null}
                <button
                  className="mt-3 w-full rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={disabled || !approval.canApprove}
                  onClick={() => onApproveJoinRequest(request.requester)}
                  type="button"
                >
                  Approve Member
                </button>
                {dismissal.canDismiss || dismissal.reason ? (
                  <button
                    className="mt-2 w-full rounded border border-red-300/25 px-3 py-2 text-sm font-semibold text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={disabled || !dismissal.canDismiss}
                    onClick={() => onDismissJoinRequest(request.requester)}
                    type="button"
                  >
                    Dismiss application
                  </button>
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

export function AllianceExitActionPanel({
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
    <div className="rounded border border-red-300/20 bg-red-950/20 p-3">
      <h3 className="text-sm font-semibold text-red-50">Alliance Actions</h3>
      {exitAction.reason ? (
        <p className="mt-2 rounded border border-amber-300/20 bg-amber-300/10 px-2 py-1.5 text-xs text-amber-100">{exitAction.reason}</p>
      ) : null}
      {confirming && !blocked ? (
        <div className="mt-3 rounded border border-red-300/25 bg-black/20 p-3">
          <p className="text-sm font-semibold text-red-50">{exitAction.label}?</p>
          <p className="mt-1 text-xs text-red-100/80">
            {isDelete ? "This removes the alliance after the wallet transaction confirms." : "This removes your wallet from the alliance after the wallet transaction confirms."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="rounded border border-red-300/30 px-3 py-2 text-sm font-semibold text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled}
              onClick={() => {
                setConfirming(false);
                onSubmit();
              }}
              type="button"
            >
              {confirmLabel}
            </button>
            <button
              className="rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10"
              onClick={() => setConfirming(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="mt-3 rounded border border-red-300/30 px-3 py-2 text-sm font-semibold text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={blocked}
          onClick={() => setConfirming(true)}
          type="button"
        >
          {exitAction.label}
        </button>
      )}
    </div>
  );
}

function RosterSection({
  canManageMembers,
  disabled,
  isOwner,
  roster,
  viewer,
  onKick,
  onOpenPlayer,
  onSetRole,
}: {
  canManageMembers: boolean;
  disabled: boolean;
  isOwner: boolean;
  roster: RosterGroups;
  viewer?: string | undefined;
  onKick: (playerAddress: string) => void;
  onOpenPlayer: (playerAddress: string) => void;
  onSetRole: (playerAddress: string, role: "member" | "officer") => void;
}) {
  return (
    <div className="grid gap-3">
      <RosterList
        canManageMembers={canManageMembers}
        disabled={disabled}
        isOwner={isOwner}
        rows={roster.officers}
        title="Officers"
        viewer={viewer}
        onKick={onKick}
        onOpenPlayer={onOpenPlayer}
        onSetRole={onSetRole}
      />
      <RosterList
        canManageMembers={canManageMembers}
        disabled={disabled}
        isOwner={isOwner}
        rows={roster.members}
        title="Members"
        viewer={viewer}
        onKick={onKick}
        onOpenPlayer={onOpenPlayer}
        onSetRole={onSetRole}
      />
    </div>
  );
}

function RosterList({
  canManageMembers,
  disabled,
  isOwner,
  rows,
  title,
  viewer,
  onKick,
  onOpenPlayer,
  onSetRole,
}: {
  canManageMembers: boolean;
  disabled: boolean;
  isOwner: boolean;
  rows: RosterMember[];
  title: string;
  viewer?: string | undefined;
  onKick: (playerAddress: string) => void;
  onOpenPlayer: (playerAddress: string) => void;
  onSetRole: (playerAddress: string, role: "member" | "officer") => void;
}) {
  const [page, setPage] = useState(1);
  const pageCount = rosterPageCount(rows.length);
  const clampedPage = Math.min(page, pageCount);
  const visibleRows = rosterPageRows(rows, clampedPage);

  useEffect(() => {
    setPage(1);
  }, [rows]);

  return (
    <div className="rounded border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</h3>
        <span className="text-xs text-slate-500">{rows.length}</span>
      </div>
      {rows.length ? (
        <div className="mt-2 grid gap-1.5">
          {visibleRows.map((member) => (
            <MemberRow
              canManageMembers={canManageMembers}
              disabled={disabled}
              isOwner={isOwner}
              key={member.address}
              member={member}
              viewer={viewer}
              onKick={onKick}
              onOpenPlayer={onOpenPlayer}
              onSetRole={onSetRole}
            />
          ))}
          {pageCount > 1 ? (
            <RosterPagination
              page={clampedPage}
              pageCount={pageCount}
              total={rows.length}
              onNext={() => setPage((current) => Math.min(pageCount, current + 1))}
              onPrevious={() => setPage((current) => Math.max(1, current - 1))}
            />
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-400">No {title.toLowerCase()} found.</p>
      )}
    </div>
  );
}

export function rosterPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / allianceRosterPageSize));
}

export function rosterPageRows<T>(rows: T[], page: number): T[] {
  const clampedPage = Math.min(Math.max(1, page), rosterPageCount(rows.length));
  const start = (clampedPage - 1) * allianceRosterPageSize;
  return rows.slice(start, start + allianceRosterPageSize);
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
  viewer,
  onKick,
  onOpenPlayer,
  onSetRole,
}: {
  canManageMembers: boolean;
  disabled: boolean;
  isOwner: boolean;
  member: RosterMember;
  viewer?: string | undefined;
  onKick: (playerAddress: string) => void;
  onOpenPlayer: (playerAddress: string) => void;
  onSetRole: (playerAddress: string, role: "member" | "officer") => void;
}) {
  const isViewer = viewer?.toLowerCase() === member.address.toLowerCase();
  const canKick = canManageMembers && member.role === "member";
  const ownerCanChangeRole = isOwner && member.role !== "owner";

  return (
    <div className="grid gap-2 rounded border border-white/10 bg-white/[0.03] px-2 py-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <button className="min-w-0 text-left" onClick={() => onOpenPlayer(member.address)} type="button">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {member.role === "owner" ? <Crown size={14} className="text-amber-200" /> : <UserRound size={14} className="text-slate-500" />}
          <span className="font-mono text-sm text-white">{playerLabel(member.displayName, member.address)}</span>
          {member.displayName ? (
            <span className="font-mono text-xs text-slate-500">{shortAddress(member.address)}</span>
          ) : null}
          <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-300">
            {roleLabel(member.role)}
          </span>
          {isViewer ? <span className="text-xs text-cyan-100">You</span> : null}
        </div>
        <p className="mt-1 text-xs text-slate-500">Joined {formatUserTimestamp(member.joinedAt)}</p>
      </button>
      {canManageMembers ? (
        <div className="flex flex-wrap gap-2 md:justify-end">
          {ownerCanChangeRole && member.role === "member" ? (
            <button className="rounded border border-white/10 px-2 py-1 text-xs font-semibold text-slate-100 disabled:opacity-50" disabled={disabled} onClick={() => onSetRole(member.address, "officer")} type="button">
              Make Officer
            </button>
          ) : null}
          {ownerCanChangeRole && member.role === "officer" ? (
            <button className="rounded border border-white/10 px-2 py-1 text-xs font-semibold text-slate-100 disabled:opacity-50" disabled={disabled} onClick={() => onSetRole(member.address, "member")} type="button">
              Make Member
            </button>
          ) : null}
          {(canKick || (isOwner && member.role === "officer")) && !isViewer ? (
            <button className="rounded border border-red-300/30 px-2 py-1 text-xs font-semibold text-red-100 disabled:opacity-50" disabled={disabled} onClick={() => onKick(member.address)} type="button">
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
        {profile.status === "error" ? <Notice tone="error">{profile.label}</Notice> : null}
        {profile.status === "loaded" ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Planets" value={String(profile.planets?.planets.length ?? 0)} />
              <MiniStat label="Total Score" value={formatScore(profile.highscore?.score.total)} />
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

function RoleInfo({ role }: { role: AllianceRole }) {
  return (
    <div className="rounded border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-2 text-sm text-cyan-50">
      {role === "owner" ? "Owner: profile editing, officer management, invitations, applications, and removals." : null}
      {role === "officer" ? "Officer: invitations, application approvals, and member removals." : null}
      {role === "member" ? "Member: roster access and alliance coordination." : null}
      {role === "none" ? "No alliance role is active for this wallet." : null}
    </div>
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
    <div className={`rounded border px-3 py-2 text-sm ${tone === "error" ? "border-red-400/30 bg-red-400/10 text-red-100" : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100"}`}>
      {children}
    </div>
  );
}

export function allianceDisplayName(alliance: Pick<DirectoryEntry, "tag" | "name">): string {
  return `${alliance.tag} - ${alliance.name}`;
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
    });
  }

  const all = [...byAddress.values()].sort(compareRosterMembers);
  return {
    all,
    officers: all.filter((member) => member.role === "owner" || member.role === "officer"),
    members: all.filter((member) => member.role === "member"),
  };
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

function currentAllianceEntry(allianceState: ChainAllianceState | null, rosterCount: number): AllianceEntry | null {
  const profile = allianceState?.profile;
  const allianceId = allianceState?.membership.allianceId;
  if (!profile || !allianceId || allianceId === "0") return null;
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
  };
}

function compareRosterMembers(left: RosterMember, right: RosterMember): number {
  const roleOrder: Record<AllianceRole, number> = {
    owner: 0,
    officer: 1,
    member: 2,
    none: 3,
  };
  const roleDelta = roleOrder[left.role] - roleOrder[right.role];
  if (roleDelta !== 0) return roleDelta;
  return left.address.localeCompare(right.address);
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

async function fetchPlayerHighscore(apiBaseUrl: string, wallet: string): Promise<HighscoreEntry | null> {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/wallet/${encodeURIComponent(wallet)}/highscore`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Highscore request failed with ${response.status}`);
  const body = await response.json() as { entry?: HighscoreEntry | null };
  return body.entry ?? null;
}
