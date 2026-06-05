import type { ComponentChildren } from "preact";
import { ArrowLeft, Crown, RefreshCw, UserRound } from "lucide-preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { Coordinates } from "../types";
import { formatUserTimestamp } from "../timestampFormat";
import {
  fetchHighscores,
  fetchWalletPlanets,
  shortAddress,
  type ChainAllianceState,
  type HighscoreEntry,
  type WalletPlanetsResponse,
} from "../walletFlow";
import {
  allianceRosterPageSize,
  allianceDisplayName,
  allianceExitActionState,
  AllianceExitActionPanel,
  allianceJoinRequestApprovalState,
  allianceJoinRequestDismissalState,
  buildAllianceRoster,
  findAllianceEntry,
  rosterPageCount,
  rosterPageRows,
} from "./AlliancePage";
import { VeydriftLoader } from "./VeydriftLoader";

type PlayerInspectState =
  | { status: "loading" }
  | { status: "loaded"; planets: WalletPlanetsResponse | null; highscore: HighscoreEntry | null }
  | { status: "error"; label: string };

type RosterMember = ChainAllianceState["members"][number];

export function PlayerInspectPage({
  apiBaseUrl,
  currentWallet,
  onBack,
  onOpenAlliance,
  onSelectPlanet,
  wallet,
}: {
  apiBaseUrl: string | undefined;
  currentWallet?: string | undefined;
  onBack: () => void;
  onOpenAlliance: (allianceId: string) => void;
  onSelectPlanet: (coords: Coordinates) => void;
  wallet: string;
}) {
  const [state, setState] = useState<PlayerInspectState>({ status: "loading" });

  useEffect(() => {
    if (!apiBaseUrl) {
      setState({ status: "error", label: "Game API unavailable." });
      return;
    }

    let disposed = false;
    setState({ status: "loading" });
    Promise.allSettled([
      fetchWalletPlanets(apiBaseUrl, wallet),
      fetchHighscores(apiBaseUrl),
    ]).then(([planetsResult, highscoresResult]) => {
      if (disposed) return;
      const planets = planetsResult.status === "fulfilled" ? planetsResult.value : null;
      const highscore = highscoresResult.status === "fulfilled"
        ? highscoresResult.value.rankings.total.find((entry) => entry.wallet.toLowerCase() === wallet.toLowerCase()) ?? null
        : null;
      if (!planets && !highscore) {
        setState({ status: "error", label: "Public player profile could not be loaded." });
        return;
      }
      setState({ status: "loaded", planets, highscore });
    });

    return () => {
      disposed = true;
    };
  }, [apiBaseUrl, wallet]);

  const displayName = state.status === "loaded"
    ? state.highscore?.displayName?.trim() || state.planets?.player?.displayName?.trim() || shortAddress(wallet)
    : shortAddress(wallet);
  const isCurrentWallet = currentWallet?.toLowerCase() === wallet.toLowerCase();

  return (
    <InspectShell
      eyebrow="Player Inspect"
      title={displayName}
      subtitle={wallet}
      onBack={onBack}
    >
      {state.status === "loading" ? <VeydriftLoader label="Loading player" /> : null}
      {state.status === "error" ? <Notice tone="error">{state.label}</Notice> : null}
      {state.status === "loaded" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="grid gap-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <MiniStat label="Rank" value={state.highscore ? `#${state.highscore.rank}` : "Unranked"} />
              <MiniStat label="Planets" value={String(state.planets?.planets.length ?? state.highscore?.planetCount ?? 0)} />
              <MiniStat label="Total Score" value={formatScore(state.highscore?.score.total)} />
              <MiniStat label="Wallet" value={isCurrentWallet ? "You" : shortAddress(wallet)} />
            </div>

            <Panel title="Planets">
              {state.planets?.planets.length ? (
                <div className="grid gap-2">
                  {state.planets.planets.map((planet) => (
                    <button
                      className="grid gap-1 rounded border border-white/10 bg-black/20 px-3 py-2 text-left hover:bg-white/[0.06]"
                      key={planet.planetId}
                      onClick={() => onSelectPlanet({ galaxy: planet.galaxy, system: planet.system, position: planet.position })}
                      type="button"
                    >
                      <span className="text-sm font-semibold text-white">{planet.name || `Planet #${planet.planetId}`}</span>
                      <span className="text-xs text-slate-500">
                        [{planet.galaxy}:{planet.system}:{planet.position}] / {planet.fieldsUsed}/{planet.fieldsCapacity} fields
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No indexed public planets are available for this player.</p>
              )}
            </Panel>
          </section>

          <aside className="grid content-start gap-4">
            <Panel title="Alliance">
              {state.highscore?.alliance ? (
                <button
                  className="w-full rounded border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-left hover:bg-cyan-300/15"
                  onClick={() => onOpenAlliance(state.highscore?.alliance?.allianceId ?? "")}
                  type="button"
                >
                  <span className="font-mono text-xs font-semibold text-cyan-100">[{state.highscore.alliance.tag}]</span>
                  <span className="ml-2 text-sm font-semibold text-white">{state.highscore.alliance.name}</span>
                </button>
              ) : (
                <p className="text-sm text-slate-400">No public alliance is indexed for this player.</p>
              )}
            </Panel>
            <Panel title="Score">
              {state.highscore ? (
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(state.highscore.score).map(([key, value]) => (
                    <MiniStat key={key} label={scoreLabel(key)} value={formatScore(value)} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No public score row is indexed yet.</p>
              )}
            </Panel>
          </aside>
        </div>
      ) : null}
    </InspectShell>
  );
}

export function AllianceInspectPage({
  actionBusy,
  allianceId,
  allianceState,
  canTransact,
  disabled,
  onApproveJoinRequest,
  onBack,
  onDismissJoinRequest,
  onInvite,
  onKick,
  onLeaveAlliance,
  onOpenPlayer,
  onRefresh,
  onSetRole,
}: {
  actionBusy: boolean;
  allianceId: string;
  allianceState: ChainAllianceState | null;
  canTransact: boolean;
  disabled: boolean;
  onApproveJoinRequest: (playerAddress: string) => void;
  onBack: () => void;
  onDismissJoinRequest: (playerAddress: string) => void;
  onInvite: (playerAddress: string) => void;
  onKick: (playerAddress: string) => void;
  onLeaveAlliance: () => void;
  onOpenPlayer: (wallet: string) => void;
  onRefresh: () => void;
  onSetRole: (playerAddress: string, role: "member" | "officer") => void;
}) {
  const [inviteAddress, setInviteAddress] = useState("");
  const currentAllianceId = allianceState?.membership.allianceId ?? "0";
  const isCurrentAlliance = currentAllianceId === allianceId && currentAllianceId !== "0";
  const profile = allianceState?.profile;
  const roster = useMemo(
    () => buildAllianceRoster(isCurrentAlliance ? allianceState?.members ?? [] : [], profile?.owner),
    [allianceState?.members, isCurrentAlliance, profile?.owner]
  );
  const currentAlliance = isCurrentAlliance && profile ? {
    active: profile.active,
    allianceId,
    createdAt: profile.createdAt,
    description: profile.description,
    memberCount: Math.max(profile.memberCount, roster.all.length),
    name: profile.name,
    owner: profile.owner,
    ownerDisplayName: profile.ownerDisplayName ?? null,
    rosterAvailable: true,
    tag: profile.tag,
  } : null;
  const alliance = findAllianceEntry(allianceState?.directory ?? [], allianceId, currentAlliance);
  const role = allianceState?.membership.role ?? "none";
  const canManageMembers = isCurrentAlliance && (role === "owner" || role === "officer");
  const isOwner = isCurrentAlliance && role === "owner";
  const busy = disabled || actionBusy || !canTransact;
  const exitAction = allianceExitActionState(isCurrentAlliance ? allianceState : null);

  return (
    <InspectShell
      eyebrow="Alliance Inspect"
      title={alliance ? allianceDisplayName(alliance) : `Alliance #${allianceId}`}
      subtitle={alliance?.description || "Public alliance details"}
      onBack={onBack}
      action={(
        <button className="icon-button" disabled={actionBusy} onClick={onRefresh} type="button" title="Refresh alliance state">
          <RefreshCw size={16} />
        </button>
      )}
    >
      {!allianceState ? <VeydriftLoader label="Loading alliance" /> : null}
      {allianceState && !alliance ? <Notice tone="error">Alliance details are not indexed for this id yet.</Notice> : null}
      {alliance ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <MiniStat label="Tag" value={alliance.tag} />
              <MiniStat label="Members" value={String(alliance.memberCount)} />
              <MiniStat label="Created" value={formatUserTimestamp(alliance.createdAt)} />
            </div>

            {isCurrentAlliance ? (
              <Panel title="Roster">
                <RosterGroup title="Officers" members={roster.officers} isOwner={isOwner} disabled={busy} viewer={allianceState?.wallet} onKick={onKick} onOpenPlayer={onOpenPlayer} onSetRole={onSetRole} />
                <RosterGroup title="Members" members={roster.members} isOwner={isOwner} disabled={busy} viewer={allianceState?.wallet} onKick={onKick} onOpenPlayer={onOpenPlayer} onSetRole={onSetRole} />
              </Panel>
            ) : (
              <Panel title="Public Roster">
                <p className="text-sm text-slate-400">Full member roster is only available for your current alliance. Public directory data exposes owner and member count.</p>
                <button className="mt-3 rounded border border-white/10 bg-black/20 px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10" onClick={() => onOpenPlayer(alliance.owner)} type="button">
                  Owner <span className="font-mono text-cyan-100">{alliance.ownerDisplayName?.trim() || shortAddress(alliance.owner)}</span>
                </button>
              </Panel>
            )}
          </section>

          <aside className="grid content-start gap-4">
            <Panel title="Description">
              <p className="text-sm leading-6 text-slate-300">{alliance.description || "No public alliance description."}</p>
            </Panel>
            {canManageMembers ? (
              <Panel title="Invite">
                <div className="grid gap-2">
                  <input
                    className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50"
                    onInput={(event) => setInviteAddress(event.currentTarget.value)}
                    placeholder="0x..."
                    value={inviteAddress}
                  />
                  <button
                    className="rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={busy || !inviteAddress.trim()}
                    onClick={() => onInvite(inviteAddress.trim())}
                    type="button"
                  >
                    Invite
                  </button>
                </div>
              </Panel>
            ) : null}
            {isCurrentAlliance ? (
              <AllianceExitActionPanel
                disabled={busy}
                exitAction={exitAction}
                onSubmit={onLeaveAlliance}
              />
            ) : null}
            {canManageMembers ? (
              <Panel title="Applications">
                {(allianceState?.allianceJoinRequests ?? []).length ? (
                  <div className="grid gap-2">
                    {(allianceState?.allianceJoinRequests ?? []).map((request) => {
                      const approval = allianceJoinRequestApprovalState(allianceState, request);
                      const dismissal = allianceJoinRequestDismissalState(allianceState, request);
                      return (
                        <div className="rounded border border-white/10 bg-black/20 p-3" key={request.requester}>
                          <button className="font-mono text-sm text-white hover:text-cyan-100" onClick={() => onOpenPlayer(request.requester)} type="button">
                            {request.requesterDisplayName?.trim() || shortAddress(request.requester)}
                          </button>
                          <p className="mt-1 text-xs text-slate-500">Requested {formatUserTimestamp(request.requestedAt)}</p>
                          {approval.reason ? <p className="mt-2 rounded border border-amber-300/20 bg-amber-300/10 px-2 py-1.5 text-xs text-amber-100">{approval.reason}</p> : null}
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            <button className="rounded border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 disabled:opacity-50" disabled={busy || !approval.canApprove} onClick={() => onApproveJoinRequest(request.requester)} type="button">Approve</button>
                            <button className="rounded border border-red-300/25 px-3 py-2 text-sm font-semibold text-red-100 disabled:opacity-50" disabled={busy || !dismissal.canDismiss} onClick={() => onDismissJoinRequest(request.requester)} type="button">Dismiss</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No pending applications.</p>
                )}
              </Panel>
            ) : null}
          </aside>
        </div>
      ) : null}
    </InspectShell>
  );
}

function InspectShell({ action, children, eyebrow, onBack, subtitle, title }: {
  action?: ComponentChildren;
  children: ComponentChildren;
  eyebrow: string;
  onBack: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <section className="min-h-0 overflow-auto bg-[#080d16]">
      <div className="mx-auto grid w-full max-w-7xl gap-4 p-4">
        <header className="flex flex-col gap-3 border-b border-white/10 pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <button className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-cyan-100" onClick={onBack} type="button">
              <ArrowLeft size={14} /> Back
            </button>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200/70">{eyebrow}</p>
            <h1 className="mt-1 truncate text-2xl font-semibold text-white">{title}</h1>
            <p className="mt-1 break-all text-sm text-slate-400">{subtitle}</p>
          </div>
          {action}
        </header>
        {children}
      </div>
    </section>
  );
}

function Panel({ children, title }: { children: ComponentChildren; title: string }) {
  return (
    <section className="rounded border border-white/10 bg-white/[0.03] p-4">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function RosterGroup({ disabled, isOwner, members, onKick, onOpenPlayer, onSetRole, title, viewer }: {
  disabled: boolean;
  isOwner: boolean;
  members: RosterMember[];
  onKick: (playerAddress: string) => void;
  onOpenPlayer: (wallet: string) => void;
  onSetRole: (playerAddress: string, role: "member" | "officer") => void;
  title: string;
  viewer?: string | undefined;
}) {
  const [page, setPage] = useState(1);
  const pageCount = rosterPageCount(members.length);
  const clampedPage = Math.min(page, pageCount);
  const visibleMembers = rosterPageRows(members, clampedPage);

  useEffect(() => {
    setPage(1);
  }, [members]);

  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        <span>{title}</span>
        <span>{members.length}</span>
      </div>
      {members.length ? (
        <div className="grid gap-1.5">
          {visibleMembers.map((member) => {
            const isViewer = viewer?.toLowerCase() === member.address.toLowerCase();
            const ownerCanChangeRole = isOwner && member.role !== "owner";
            return (
              <div className="grid gap-2 rounded border border-white/10 bg-black/20 px-2 py-2 md:grid-cols-[minmax(0,1fr)_auto]" key={member.address}>
                <button className="min-w-0 text-left" onClick={() => onOpenPlayer(member.address)} type="button">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    {member.role === "owner" ? <Crown size={14} className="text-amber-200" /> : <UserRound size={14} className="text-slate-500" />}
                    <span className="font-mono text-sm text-white">{member.displayName?.trim() || shortAddress(member.address)}</span>
                    <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-300">{member.role}</span>
                    {isViewer ? <span className="text-xs text-cyan-100">You</span> : null}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">Joined {formatUserTimestamp(member.joinedAt)}</span>
                </button>
                {ownerCanChangeRole || (member.role !== "owner" && !isViewer) ? (
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    {ownerCanChangeRole && member.role === "member" ? <button className="rounded border border-white/10 px-2 py-1 text-xs font-semibold text-slate-100 disabled:opacity-50" disabled={disabled} onClick={() => onSetRole(member.address, "officer")} type="button">Make Officer</button> : null}
                    {ownerCanChangeRole && member.role === "officer" ? <button className="rounded border border-white/10 px-2 py-1 text-xs font-semibold text-slate-100 disabled:opacity-50" disabled={disabled} onClick={() => onSetRole(member.address, "member")} type="button">Make Member</button> : null}
                    {member.role !== "owner" && !isViewer ? <button className="rounded border border-red-300/30 px-2 py-1 text-xs font-semibold text-red-100 disabled:opacity-50" disabled={disabled} onClick={() => onKick(member.address)} type="button">Remove</button> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {pageCount > 1 ? (
            <div className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <span>
                {(clampedPage - 1) * allianceRosterPageSize + 1}-{Math.min(clampedPage * allianceRosterPageSize, members.length)} of {members.length}
              </span>
              <div className="flex items-center gap-2">
                <button className="rounded border border-white/10 px-2 py-1 font-semibold text-slate-200 disabled:opacity-50" disabled={clampedPage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">Previous</button>
                <span>Page {clampedPage} of {pageCount}</span>
                <button className="rounded border border-white/10 px-2 py-1 font-semibold text-slate-200 disabled:opacity-50" disabled={clampedPage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} type="button">Next</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-slate-400">No {title.toLowerCase()} found.</p>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/20 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function Notice({ children, tone = "info" }: { children: ComponentChildren; tone?: "error" | "info" }) {
  return (
    <div className={`rounded border px-3 py-2 text-sm ${tone === "error" ? "border-red-400/30 bg-red-400/10 text-red-100" : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100"}`}>
      {children}
    </div>
  );
}

function formatScore(value: string | undefined): string {
  if (!value) return "0";
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    return value;
  }
}

function scoreLabel(key: string): string {
  if (key === "researchLevels") return "Research Lvls";
  if (key === "fleetCount") return "Ships";
  return key;
}
