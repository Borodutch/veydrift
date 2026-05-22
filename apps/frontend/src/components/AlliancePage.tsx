import { Crown, RefreshCw, UserCog, Users } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { AllianceRole, ChainAllianceState } from "../walletFlow";
import { shortAddress } from "../walletFlow";

type AllianceActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

interface AlliancePageProps {
  actionState: AllianceActionState;
  allianceState: ChainAllianceState | null;
  canTransact: boolean;
  error?: string | undefined;
  loading: boolean;
  onAcceptInvite: (allianceId: string) => void;
  onCreate: (tag: string, name: string, description: string) => void;
  onInvite: (playerAddress: string) => void;
  onKick: (playerAddress: string) => void;
  onRefresh: () => void;
  onSetRole: (playerAddress: string, role: "member" | "officer") => void;
}

export function AlliancePage({
  actionState,
  allianceState,
  canTransact,
  error,
  loading,
  onAcceptInvite,
  onCreate,
  onInvite,
  onKick,
  onRefresh,
  onSetRole,
}: AlliancePageProps) {
  const [tag, setTag] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [inviteAddress, setInviteAddress] = useState("");
  const [inviteAllianceId, setInviteAllianceId] = useState("");
  const [manageAddress, setManageAddress] = useState("");

  const profile = allianceState?.profile;
  const isMember = Boolean(profile && allianceState?.membership.allianceId !== "0");
  const role = allianceState?.membership.role ?? "none";
  const canManage = role === "owner" || role === "officer";
  const canManageOfficers = role === "owner";
  const disabled = !canTransact || loading || actionState.status === "pending";
  const selectedMember = allianceState?.members.find((member) => member.address.toLowerCase() === manageAddress.trim().toLowerCase());
  const canKickSelected = canManage && Boolean(selectedMember) && selectedMember?.role === "member";
  const ownerCanManageSelected = canManageOfficers && Boolean(selectedMember) && selectedMember?.role !== "owner";

  return (
    <section className="min-h-0 overflow-auto bg-[#080d16]">
      <div className="mx-auto grid w-full max-w-6xl gap-4 p-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
            <div>
              <h1 className="text-xl font-semibold text-white">Alliance</h1>
              <p className="mt-1 text-sm text-slate-400">
                {profile ? `${profile.tag} - ${profile.name}` : "On-chain alliance identity, roster, and coordination link."}
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

          <div className="grid gap-3 md:grid-cols-3">
            <Metric icon={Users} label="Members" value={profile ? String(profile.memberCount) : "0"} />
            <Metric icon={Crown} label="Role" value={role} />
            <Metric icon={UserCog} label="Officers" value={String(allianceState?.members.filter((member) => member.role === "officer").length ?? 0)} />
          </div>

          {profile ? (
            <div className="rounded border border-white/10 bg-white/[0.03] p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Readout label="Alliance ID" value={allianceState?.membership.allianceId ?? "0"} />
                <Readout label="Owner" value={shortAddress(profile.owner)} />
                <Readout label="Description / Link" value={profile.description || "None"} />
                <Readout label="Created" value={profile.createdAt} />
              </div>
            </div>
          ) : (
            <div className="rounded border border-white/10 bg-white/[0.03] p-4">
              <h2 className="text-sm font-semibold text-white">Create Alliance</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <TextField label="Tag" value={tag} onInput={setTag} placeholder="VDFT" />
                <TextField label="Name" value={name} onInput={setName} placeholder="Veydrift Union" />
                <TextField label="Description / Link" value={description} onInput={setDescription} placeholder="Discord: https://..." />
              </div>
              <button
                className="mt-4 rounded bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled || !tag.trim() || !name.trim()}
                onClick={() => onCreate(tag.trim(), name.trim(), description.trim())}
                type="button"
              >
                Create Alliance
              </button>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <Panel title="Roles">
            <div className="space-y-2 text-sm text-slate-300">
              <p>Owner: invites or approves members, kicks members, and adds or removes officers.</p>
              <p>Officers: invite or approve members and kick members.</p>
              <p>Members: appear on the roster and use the alliance link for coordination outside Veydrift.</p>
            </div>
          </Panel>

          <Panel title="Member Management">
            <TextField label="Wallet" value={inviteAddress} onInput={setInviteAddress} placeholder="0x..." />
            <button
              className="mt-3 w-full rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled || !isMember || !canManage || !inviteAddress.trim()}
              onClick={() => onInvite(inviteAddress.trim())}
              type="button"
            >
              Invite Member
            </button>
          </Panel>

          <Panel title="Accept Invitation">
            <TextField label="Alliance ID" value={inviteAllianceId} onInput={setInviteAllianceId} placeholder="1" />
            <button
              className="mt-3 w-full rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled || isMember || !inviteAllianceId.trim()}
              onClick={() => onAcceptInvite(inviteAllianceId.trim())}
              type="button"
            >
              Accept Invite
            </button>
          </Panel>

          <Panel title="Roster Actions">
            <div className="grid gap-3">
              <TextField label="Member Wallet" value={manageAddress} onInput={setManageAddress} placeholder="0x..." />
            </div>
            <div className="mt-3 grid gap-2">
              <button
                className="rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled || !canManageOfficers || selectedMember?.role !== "member"}
                onClick={() => onSetRole(manageAddress.trim(), "officer")}
                type="button"
              >
                Make Officer
              </button>
              <button
                className="rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled || !canManageOfficers || selectedMember?.role !== "officer"}
                onClick={() => onSetRole(manageAddress.trim(), "member")}
                type="button"
              >
                Make Member
              </button>
              <button
                className="rounded border border-red-300/30 px-3 py-2 text-sm font-semibold text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled || !(canKickSelected || ownerCanManageSelected)}
                onClick={() => onKick(manageAddress.trim())}
                type="button"
              >
                Kick
              </button>
            </div>
          </Panel>
        </aside>

        {profile ? (
          <div className="lg:col-span-2">
            <Panel title="Roster">
              {allianceState?.members.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="text-xs uppercase tracking-[0.14em] text-slate-500">
                      <tr>
                        <th className="py-2 pr-3 font-medium">Wallet</th>
                        <th className="py-2 pr-3 font-medium">Role</th>
                        <th className="py-2 font-medium">Joined</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 text-slate-200">
                      {allianceState.members.map((member) => (
                        <tr key={member.address}>
                          <td className="py-2 pr-3 font-mono">{shortAddress(member.address)}</td>
                          <td className="py-2 pr-3 capitalize">{roleLabel(member.role)}</td>
                          <td className="py-2 font-mono text-slate-400">{member.joinedAt}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-slate-400">No roster entries returned yet.</p>
              )}
            </Panel>
          </div>
        ) : null}
      </div>
    </section>
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
      <p className="mt-1 break-all font-mono text-sm text-slate-200">{value}</p>
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

function Notice({ children, tone = "info" }: { children: ComponentChildren; tone?: "error" | "info" }) {
  return (
    <div className={`rounded border px-3 py-2 text-sm ${tone === "error" ? "border-red-400/30 bg-red-400/10 text-red-100" : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100"}`}>
      {children}
    </div>
  );
}
