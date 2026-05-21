import { RefreshCw, Shield, Swords, Users } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { ChainAllianceState } from "../walletFlow";
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
  onCreate: (tag: string, name: string, metadataURI: string) => void;
  onInvite: (playerAddress: string) => void;
  onOpenDefenseIntent: (defenderPlanetId: string, hostileMissionId: string) => void;
  onRefresh: () => void;
}

export function AlliancePage({
  actionState,
  allianceState,
  canTransact,
  error,
  loading,
  onCreate,
  onInvite,
  onOpenDefenseIntent,
  onRefresh,
}: AlliancePageProps) {
  const [tag, setTag] = useState("");
  const [name, setName] = useState("");
  const [metadataURI, setMetadataURI] = useState("");
  const [inviteAddress, setInviteAddress] = useState("");
  const [defenderPlanetId, setDefenderPlanetId] = useState("");
  const [hostileMissionId, setHostileMissionId] = useState("");

  const profile = allianceState?.profile;
  const isMember = Boolean(profile && allianceState?.membership.allianceId !== "0");
  const canManage = allianceState?.membership.role === "leader" || allianceState?.membership.role === "officer";
  const disabled = !canTransact || loading || actionState.status === "pending";

  return (
    <section className="min-h-0 overflow-auto bg-[#080d16]">
      <div className="mx-auto grid w-full max-w-6xl gap-4 p-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
            <div>
              <h1 className="text-xl font-semibold text-white">Alliance</h1>
              <p className="mt-1 text-sm text-slate-400">
                {profile ? `${profile.tag} - ${profile.name}` : "Canonical alliance state for public defense coordination."}
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
            <Metric icon={Shield} label="Role" value={allianceState?.membership.role ?? "none"} />
            <Metric icon={Swords} label="ACS hooks" value={allianceState?.defenseCoordination.acsDefendSupported ? "Ready" : "Unavailable"} />
          </div>

          {profile ? (
            <div className="rounded border border-white/10 bg-white/[0.03] p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Readout label="Alliance ID" value={allianceState?.membership.allianceId ?? "0"} />
                <Readout label="Founder" value={shortAddress(profile.founder)} />
                <Readout label="Metadata" value={profile.metadataURI || "None"} />
                <Readout label="Created" value={profile.createdAt} />
              </div>
            </div>
          ) : (
            <div className="rounded border border-white/10 bg-white/[0.03] p-4">
              <h2 className="text-sm font-semibold text-white">Create Alliance</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <TextField label="Tag" value={tag} onInput={setTag} placeholder="VDFT" />
                <TextField label="Name" value={name} onInput={setName} placeholder="Veydrift Union" />
                <TextField label="Metadata URI" value={metadataURI} onInput={setMetadataURI} placeholder="ipfs://..." />
              </div>
              <button
                className="mt-4 rounded bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled || !tag.trim() || !name.trim()}
                onClick={() => onCreate(tag.trim(), name.trim(), metadataURI.trim())}
                type="button"
              >
                Create Alliance
              </button>
            </div>
          )}
        </div>

        <aside className="space-y-4">
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

          <Panel title="Defense Coordination">
            <div className="grid gap-3">
              <TextField label="Defender Planet ID" value={defenderPlanetId} onInput={setDefenderPlanetId} placeholder="1" />
              <TextField label="Hostile Mission ID" value={hostileMissionId} onInput={setHostileMissionId} placeholder="42" />
            </div>
            <button
              className="mt-3 w-full rounded border border-cyan-300/30 px-3 py-2 text-sm font-semibold text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled || !isMember || !defenderPlanetId.trim() || !hostileMissionId.trim()}
              onClick={() => onOpenDefenseIntent(defenderPlanetId.trim(), hostileMissionId.trim())}
              type="button"
            >
              Open ACS Defense
            </button>
          </Panel>
        </aside>
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
