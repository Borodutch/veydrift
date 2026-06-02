import { Crown, RefreshCw, UserCog, Users } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { AllianceRole, ChainAllianceState } from "../walletFlow";
import { shortAddress } from "../walletFlow";
import { InlineSyncIndicator, VeydriftLoader } from "./VeydriftLoader";

type AllianceActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

type DirectoryEntry = ChainAllianceState["directory"][number];
type RosterMember = ChainAllianceState["members"][number];

interface AlliancePageProps {
  actionState: AllianceActionState;
  allianceState: ChainAllianceState | null;
  canTransact: boolean;
  error?: string | undefined;
  loading: boolean;
  onAcceptInvite: (allianceId: string) => void;
  onApproveJoinRequest: (playerAddress: string) => void;
  onCancelJoinRequest: (allianceId: string) => void;
  onCreate: (tag: string, name: string, description: string) => void;
  onInvite: (playerAddress: string) => void;
  onJoinRequest: (allianceId: string) => void;
  onKick: (playerAddress: string) => void;
  onRefresh: () => void;
  onSetRole: (playerAddress: string, role: "member" | "officer") => void;
  onUpdateProfile: (tag: string, name: string, description: string) => void;
}

export function AlliancePage({
  actionState,
  allianceState,
  canTransact,
  error,
  loading,
  onAcceptInvite,
  onApproveJoinRequest,
  onCancelJoinRequest,
  onCreate,
  onInvite,
  onJoinRequest,
  onKick,
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

  const profile = allianceState?.profile;
  const role = allianceState?.membership.role ?? "none";
  const isMember = hasAllianceMembership(allianceState);
  const isOwner = role === "owner";
  const canManageMembers = role === "owner" || role === "officer";
  const disabled = !canTransact || loading || actionState.status === "pending";
  const officers = allianceState?.members.filter((member) => member.role === "owner" || member.role === "officer") ?? [];
  const members = allianceState?.members.filter((member) => member.role === "member") ?? [];
  const currentAllianceId = allianceState?.membership.allianceId ?? "0";
  const initialLoading = shouldShowAllianceInitialLoader({ allianceState, loading });
  const backgroundRefresh = shouldShowAllianceRefreshIndicator({ allianceState, loading });
  const headerSubtitle = initialLoading
    ? "Loading alliance data..."
    : profile
      ? `${profile.tag} - ${profile.name}`
      : "Create, join, and browse public alliances.";

  useEffect(() => {
    setProfileTag(profile?.tag ?? "");
    setProfileName(profile?.name ?? "");
    setProfileDescription(profile?.description ?? "");
  }, [profile?.tag, profile?.name, profile?.description]);

  return (
    <section className="min-h-0 overflow-auto bg-[#080d16]">
      <div className="mx-auto w-full max-w-6xl space-y-4 p-4">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <h1 className="text-xl font-semibold text-white">Alliance</h1>
            <p className="mt-1 text-sm text-slate-400">
              {headerSubtitle}
            </p>
          </div>
          <button className="icon-button" onClick={onRefresh} type="button" disabled={loading} title="Refresh alliance state">
            <RefreshCw size={16} />
          </button>
        </header>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {allianceState?.allianceAvailable === false ? (
          <Notice>{allianceState.unavailableReason ?? "Alliance contract is not configured."}</Notice>
        ) : null}
        {actionState.status !== "idle" ? <Notice tone={actionState.status === "error" ? "error" : "info"}>{actionState.label}</Notice> : null}

        {backgroundRefresh ? <InlineSyncIndicator label="Refreshing alliance data" /> : null}

        {initialLoading ? (
          <VeydriftLoader label="Loading alliance data" />
        ) : (
          <>
            {isMember ? (
              <div className="grid gap-3 md:grid-cols-3">
                <Metric icon={Users} label="Members" value={profile ? String(profile.memberCount) : "0"} />
                <Metric icon={Crown} label="Role" value={roleLabel(role)} />
                <Metric icon={UserCog} label="Officers" value={String(officers.length)} />
              </div>
            ) : null}

            {!isMember ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-4">
                  <Panel title="Create Alliance">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField label="Tag" value={tag} onInput={setTag} placeholder="VDFT" />
                      <TextField label="Name" value={name} onInput={setName} placeholder="Veydrift Union" />
                    </div>
                    <div className="mt-3">
                      <TextArea label="Description" value={description} onInput={setDescription} placeholder="Coordination notes, public charter, or Discord link" />
                    </div>
                    <button
                      className="mt-4 rounded bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={disabled || !tag.trim() || !name.trim()}
                      onClick={() => onCreate(tag.trim(), name.trim(), description.trim())}
                      type="button"
                    >
                      Create Alliance
                    </button>
                  </Panel>

                  <AllianceDirectory
                    alliances={allianceState?.directory ?? []}
                    disabled={disabled}
                    isMember={false}
                    pendingJoinRequests={allianceState?.pendingJoinRequests ?? []}
                    onCancelJoinRequest={onCancelJoinRequest}
                    onJoinRequest={onJoinRequest}
                  />
                </div>

                <PendingInvites
                  disabled={disabled}
                  invites={allianceState?.pendingInvites ?? []}
                  directory={allianceState?.directory ?? []}
                  onAcceptInvite={onAcceptInvite}
                />
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-4">
                  {profile ? (
                    <Panel title="Alliance Info">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Readout label="Tag" value={profile.tag} />
                        <Readout label="Name" value={profile.name} />
                        <Readout label="Alliance ID" value={currentAllianceId} />
                        <Readout label="Owner" value={playerLabel(profile.ownerDisplayName, profile.owner)} />
                        <Readout label="Created" value={profile.createdAt} />
                      </div>
                      <div className="mt-4">
                        <Readout label="Description" value={profile.description || "None"} />
                      </div>
                    </Panel>
                  ) : null}

                  {isOwner ? (
                    <Panel title="Alliance Management">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <TextField label="Tag" value={profileTag} onInput={setProfileTag} placeholder="VDFT" />
                        <TextField label="Name" value={profileName} onInput={setProfileName} placeholder="Veydrift Union" />
                      </div>
                      <div className="mt-3">
                        <TextArea label="Description" value={profileDescription} onInput={setProfileDescription} placeholder="Public alliance description" />
                      </div>
                      <button
                        className="mt-4 rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={disabled || !profileTag.trim() || !profileName.trim()}
                        onClick={() => onUpdateProfile(profileTag.trim(), profileName.trim(), profileDescription.trim())}
                        type="button"
                      >
                        Update Profile
                      </button>
                    </Panel>
                  ) : null}

                  <RosterSection
                    canManageMembers={canManageMembers}
                    disabled={disabled}
                    isOwner={isOwner}
                    members={members}
                    officers={officers}
                    viewer={allianceState?.wallet}
                    onKick={onKick}
                    onSetRole={onSetRole}
                  />

                  <AllianceDirectory
                    alliances={allianceState?.directory ?? []}
                    disabled={disabled}
                    isMember
                    pendingJoinRequests={[]}
                    onCancelJoinRequest={onCancelJoinRequest}
                    onJoinRequest={onJoinRequest}
                  />
                </div>

                <div className="space-y-4">
                  {canManageMembers ? (
                    <Panel title="Member Management">
                      <TextField label="Wallet" value={inviteAddress} onInput={setInviteAddress} placeholder="0x..." />
                      <button
                        className="mt-3 w-full rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={disabled || !inviteAddress.trim()}
                        onClick={() => onInvite(inviteAddress.trim())}
                        type="button"
                      >
                        Invite Member
                      </button>
                    </Panel>
                  ) : null}

                  {canManageMembers ? (
                    <JoinRequests
                      disabled={disabled}
                      requests={allianceState?.allianceJoinRequests ?? []}
                      onApproveJoinRequest={onApproveJoinRequest}
                    />
                  ) : null}

                  <Panel title="Roles">
                    <div className="space-y-2 text-sm text-slate-300">
                      <p>Owner: profile editing, officer management, invitations, applications, and member removal.</p>
                      <p>Officers: invitations, application approvals, and member removal.</p>
                      <p>Members: roster access and alliance coordination.</p>
                    </div>
                  </Panel>
                </div>
              </div>
            )}
          </>
        )}
      </div>
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

function AllianceDirectory({
  alliances,
  disabled,
  isMember,
  pendingJoinRequests,
  onCancelJoinRequest,
  onJoinRequest,
}: {
  alliances: DirectoryEntry[];
  disabled: boolean;
  isMember: boolean;
  pendingJoinRequests: ChainAllianceState["pendingJoinRequests"];
  onCancelJoinRequest: (allianceId: string) => void;
  onJoinRequest: (allianceId: string) => void;
}) {
  const pendingIds = new Set(pendingJoinRequests.map((request) => request.allianceId));

  return (
    <Panel title="Alliance Directory">
      {alliances.length ? (
        <div className="grid gap-3">
          {alliances.map((alliance) => {
            const pending = pendingIds.has(alliance.allianceId);
            return (
              <div className="rounded border border-white/10 bg-black/20 p-3" key={alliance.allianceId}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{alliance.tag} - {alliance.name}</p>
                    <p className="mt-1 text-sm text-slate-400">{alliance.description || "No public description."}</p>
                  </div>
                  {!isMember ? (
                    <button
                      className="rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={disabled}
                      onClick={() => pending ? onCancelJoinRequest(alliance.allianceId) : onJoinRequest(alliance.allianceId)}
                      type="button"
                    >
                      {pending ? "Cancel Request" : "Request Join"}
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-2 text-xs uppercase tracking-[0.14em] text-slate-500 sm:grid-cols-3">
                  <span>ID {alliance.allianceId}</span>
                  <span>{alliance.memberCount} members</span>
                  <span>Owner {playerLabel(alliance.ownerDisplayName, alliance.owner)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-400">No public alliances found yet.</p>
      )}
    </Panel>
  );
}

function PendingInvites({
  directory,
  disabled,
  invites,
  onAcceptInvite,
}: {
  directory: DirectoryEntry[];
  disabled: boolean;
  invites: ChainAllianceState["pendingInvites"];
  onAcceptInvite: (allianceId: string) => void;
}) {
  return (
    <Panel title="Invitations">
      {invites.length ? (
        <div className="space-y-3">
          {invites.map((invite) => {
            const alliance = directory.find((entry) => entry.allianceId === invite.allianceId);
            return (
              <div className="rounded border border-white/10 bg-black/20 p-3" key={invite.allianceId}>
                <p className="text-sm font-semibold text-white">{alliance ? `${alliance.tag} - ${alliance.name}` : `Alliance #${invite.allianceId}`}</p>
                <p className="mt-1 text-sm text-slate-400">Invited by {playerLabel(invite.inviterDisplayName, invite.inviter)}</p>
                <button
                  className="mt-3 w-full rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={disabled}
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
  disabled,
  requests,
  onApproveJoinRequest,
}: {
  disabled: boolean;
  requests: ChainAllianceState["allianceJoinRequests"];
  onApproveJoinRequest: (playerAddress: string) => void;
}) {
  return (
    <Panel title="Join Applications">
      {requests.length ? (
        <div className="space-y-3">
          {requests.map((request) => (
            <div className="rounded border border-white/10 bg-black/20 p-3" key={request.requester}>
              <p className="text-sm font-semibold text-white">{playerLabel(request.requesterDisplayName, request.requester)}</p>
              {request.requesterDisplayName ? (
                <p className="mt-1 font-mono text-xs text-slate-500">{shortAddress(request.requester)}</p>
              ) : null}
              <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">Requested {request.requestedAt}</p>
              <button
                className="mt-3 w-full rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled}
                onClick={() => onApproveJoinRequest(request.requester)}
                type="button"
              >
                Approve Member
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400">No pending applications.</p>
      )}
    </Panel>
  );
}

function RosterSection({
  canManageMembers,
  disabled,
  isOwner,
  members,
  officers,
  viewer,
  onKick,
  onSetRole,
}: {
  canManageMembers: boolean;
  disabled: boolean;
  isOwner: boolean;
  members: RosterMember[];
  officers: RosterMember[];
  viewer?: string | undefined;
  onKick: (playerAddress: string) => void;
  onSetRole: (playerAddress: string, role: "member" | "officer") => void;
}) {
  return (
    <Panel title="Roster">
      <RosterTable
        canManageMembers={canManageMembers}
        disabled={disabled}
        isOwner={isOwner}
        rows={officers}
        title="Officers"
        viewer={viewer}
        onKick={onKick}
        onSetRole={onSetRole}
      />
      <div className="mt-4">
        <RosterTable
          canManageMembers={canManageMembers}
          disabled={disabled}
          isOwner={isOwner}
          rows={members}
          title="Members"
          viewer={viewer}
          onKick={onKick}
          onSetRole={onSetRole}
        />
      </div>
    </Panel>
  );
}

function RosterTable({
  canManageMembers,
  disabled,
  isOwner,
  rows,
  title,
  viewer,
  onKick,
  onSetRole,
}: {
  canManageMembers: boolean;
  disabled: boolean;
  isOwner: boolean;
  rows: RosterMember[];
  title: string;
  viewer?: string | undefined;
  onKick: (playerAddress: string) => void;
  onSetRole: (playerAddress: string, role: "member" | "officer") => void;
}) {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-[0.14em] text-slate-500">{title}</h3>
      {rows.length ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Wallet</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                <th className="py-2 pr-3 font-medium">Joined</th>
                {canManageMembers ? <th className="py-2 font-medium">Actions</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 text-slate-200">
              {rows.map((member) => {
                const isViewer = viewer?.toLowerCase() === member.address.toLowerCase();
                const canKick = canManageMembers && member.role === "member";
                const ownerCanChangeRole = isOwner && member.role !== "owner";
                return (
                  <tr key={member.address}>
                    <td className="py-2 pr-3">
                      <span className="block font-semibold text-slate-100">{playerLabel(member.displayName, member.address)}</span>
                      {member.displayName ? (
                        <span className="block font-mono text-xs text-slate-500">{shortAddress(member.address)}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 capitalize">{roleLabel(member.role)}</td>
                    <td className="py-2 pr-3 font-mono text-slate-400">{member.joinedAt}</td>
                    {canManageMembers ? (
                      <td className="py-2">
                        <div className="flex flex-wrap gap-2">
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
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-400">No {title.toLowerCase()} found.</p>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/20 p-3">
      <div className="flex items-center gap-2 text-slate-400">
        <Icon size={15} />
        <span className="text-xs uppercase tracking-[0.14em]">{label}</span>
      </div>
      <p className="mt-2 text-lg font-semibold capitalize text-white">{value}</p>
    </div>
  );
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

function Panel({ children, title }: { children: ComponentChildren; title: string }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.03] p-4">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 break-all text-sm text-slate-200">{value}</p>
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
