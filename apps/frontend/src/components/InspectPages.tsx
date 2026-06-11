import type { ComponentChildren } from "preact";
import { ArrowLeft, Crown, UserRound } from "lucide-preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { planetImageForType, planetTypeFromTemperature } from "../data/mockUniverse";
import { fleetMissionDistance } from "../fleetMissionRules";
import type { Coordinates } from "../types";
import { formatUserTimestamp } from "../timestampFormat";
import {
  fetchHighscores,
  fetchWalletPlanets,
  shortAddress,
  type ChainAllianceState,
  type HighscoreEntry,
  type ManagedPlanetResponse,
  type OnChainResources,
  type WalletPlanetsResponse,
} from "../walletFlow";
import {
  AllianceMemberActions,
  AllianceSummary,
  allianceRosterPageSize,
  allianceDisplayName,
  allianceExitActionState,
  allianceJoinRequestApprovalState,
  allianceJoinRequestDismissalState,
  buildAllianceRoster,
  canTransferAllianceOwnership,
  findAllianceEntry,
  rosterPageCount,
  rosterPageRows,
} from "./AlliancePage";
import { OptimizedImage } from "./OptimizedImage";
import { PageHeader, RefreshButton } from "./PageHeader";
import { InspectPanelSkeleton } from "./LoadingSkeletons";

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
  originCoords,
  wallet,
}: {
  apiBaseUrl: string | undefined;
  currentWallet?: string | undefined;
  onBack: () => void;
  onOpenAlliance: (allianceId: string) => void;
  onSelectPlanet: (coords: Coordinates) => void;
  originCoords?: Coordinates | undefined;
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
  const alliance = state.status === "loaded" ? state.highscore?.alliance ?? null : null;
  const scoreItems = state.status === "loaded" ? playerInspectScoreItems(state.highscore) : [];
  const homePlanetLabel = state.status === "loaded" ? playerProfileHomePlanetLabel(state.planets, state.highscore) : undefined;

  return (
    <InspectShell
      title={displayName}
      subtitle={`${wallet}${isCurrentWallet ? " / You" : ""}`}
      titlePrefix={alliance ? (
        <button
          className="shrink-0 rounded border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 font-mono text-xs font-semibold leading-none text-cyan-100 transition hover:border-cyan-200/50 hover:bg-cyan-300/15"
          onClick={() => onOpenAlliance(alliance.allianceId)}
          title={`Open alliance ${alliance.tag}`}
          type="button"
        >
          [{alliance.tag}]
        </button>
      ) : null}
      onBack={onBack}
    >
      {state.status === "loading" ? <InspectPanelSkeleton label="Loading player" /> : null}
      {state.status === "error" ? <Notice tone="error">{state.label}</Notice> : null}
      {state.status === "loaded" ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2 rounded border border-white/10 bg-black/20 px-3 py-2">
            <CompactStat label="Rank" value={state.highscore ? `#${state.highscore.rank}` : "Unranked"} />
            <CompactStat label="Planets" value={String(state.planets?.planets.length ?? state.highscore?.planetCount ?? 0)} />
            {homePlanetLabel ? <CompactStat label="Home planet" value={homePlanetLabel} /> : null}
          </div>

          <Panel title="Planets">
            {state.planets?.planets.length ? (
              <div className="grid gap-2">
                {state.planets.planets.map((planet) => (
                  <PlayerPlanetRow
                    attackProtection={state.highscore?.attackProtection ?? null}
                    key={planet.planetId}
                    onSelectPlanet={onSelectPlanet}
                    originCoords={originCoords}
                    planet={planet}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No indexed public planets are available for this player.</p>
            )}
          </Panel>

          <Panel title="Score">
            {scoreItems.length ? (
              <dl className="divide-y divide-white/10 rounded border border-white/10 bg-black/15">
                {scoreItems.map((item) => (
                  <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm" key={item.label}>
                    <dt className="font-medium text-slate-400">{item.label}</dt>
                    <dd className="font-mono font-semibold text-slate-100">{item.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-slate-400">No public score row is indexed yet.</p>
            )}
          </Panel>
        </div>
      ) : null}
    </InspectShell>
  );
}

function PlayerPlanetRow({
  attackProtection,
  onSelectPlanet,
  originCoords,
  planet,
}: {
  attackProtection: HighscoreEntry["attackProtection"] | null;
  onSelectPlanet: (coords: Coordinates) => void;
  originCoords?: Coordinates | undefined;
  planet: ManagedPlanetResponse;
}) {
  const coords = { galaxy: planet.galaxy, system: planet.system, position: planet.position };
  const signals = playerPlanetTacticalSignals(planet, originCoords, attackProtection);

  return (
    <button
      className="grid gap-3 rounded border border-white/10 bg-black/20 p-2 text-left transition hover:border-cyan-300/25 hover:bg-white/[0.06] sm:grid-cols-[64px_minmax(0,1fr)]"
      key={planet.planetId}
      onClick={() => onSelectPlanet(coords)}
      title={`Open [${coords.galaxy}:${coords.system}:${coords.position}]`}
      type="button"
    >
      <span className="h-16 w-16 overflow-hidden rounded border border-white/10 bg-black/30">
        <OptimizedImage
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          sizes="icon"
          src={playerInspectPlanetImage(planet)}
        />
      </span>
      <span className="grid min-w-0 gap-2">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-white">{planet.name || `Planet #${planet.planetId}`}</span>
          <span className="font-mono text-xs text-cyan-100">[{coords.galaxy}:{coords.system}:{coords.position}]</span>
        </span>
        <span className="grid gap-1 text-xs text-slate-400 sm:grid-cols-2 lg:grid-cols-3">
          {signals.map((signal) => (
            <span className="min-w-0 truncate" key={signal.label}>
              <span className="text-slate-600">{signal.label}</span> {signal.value}
            </span>
          ))}
        </span>
      </span>
    </button>
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
  onTransferOwnership,
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
  onTransferOwnership: (playerAddress: string) => void;
}) {
  const [inviteAddress, setInviteAddress] = useState("");
  const [inviteFormOpen, setInviteFormOpen] = useState(false);
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
  const publicRoster = useMemo(
    () => buildAllianceRoster(!isCurrentAlliance ? alliance?.members ?? [] : [], alliance?.owner),
    [alliance?.members, alliance?.owner, isCurrentAlliance]
  );
  const role = allianceState?.membership.role ?? "none";
  const canManageMembers = isCurrentAlliance && (role === "owner" || role === "officer");
  const isOwner = isCurrentAlliance && role === "owner";
  const busy = disabled || actionBusy || !canTransact;
  const exitAction = allianceExitActionState(isCurrentAlliance ? allianceState : null);

  return (
    <InspectShell
      title={alliance ? allianceDisplayName(alliance) : `Alliance #${allianceId}`}
      subtitle={alliance?.description || "Public alliance details"}
      onBack={onBack}
      action={(
        <RefreshButton disabled={actionBusy} loading={disabled} onRefresh={onRefresh} title="Refresh alliance state" />
      )}
    >
      {!allianceState ? <InspectPanelSkeleton label="Loading alliance" /> : null}
      {allianceState && !alliance ? <Notice tone="error">Alliance details are not indexed for this id yet.</Notice> : null}
      {alliance ? (
        <div className="grid gap-4">
          <Panel title={isCurrentAlliance ? "My Alliance" : "Alliance"}>
            {isCurrentAlliance ? (
              <AllianceSummary alliance={alliance} onOpenPlayer={onOpenPlayer} />
            ) : (
              <PublicAllianceInspectSummary alliance={alliance} />
            )}
          </Panel>

          {isCurrentAlliance ? (
            <Panel title="Members">
              <RosterGroup
                canManageMembers={canManageMembers}
                disabled={busy}
                isOwner={isOwner}
                members={roster.all}
                onKick={onKick}
                onOpenPlayer={onOpenPlayer}
                onSetRole={onSetRole}
                onTransferOwnership={onTransferOwnership}
                viewer={allianceState?.wallet}
              />
              <AllianceMemberActions
                canManageMembers={canManageMembers}
                disabled={busy}
                exitAction={exitAction}
                inviteAddress={inviteAddress}
                inviteFormOpen={inviteFormOpen}
                onInvite={onInvite}
                onLeaveAlliance={onLeaveAlliance}
                onSetInviteAddress={setInviteAddress}
                onSetInviteFormOpen={setInviteFormOpen}
              />
            </Panel>
          ) : publicRoster.all.length ? (
            <Panel title="Members">
              <RosterGroup
                canManageMembers={false}
                disabled
                isOwner={false}
                members={publicRoster.all}
                onKick={onKick}
                onOpenPlayer={onOpenPlayer}
                onSetRole={onSetRole}
                onTransferOwnership={onTransferOwnership}
              />
            </Panel>
          ) : (
            <Panel title="Members">
              <p className="text-sm text-slate-400">No indexed public members are available for this alliance yet.</p>
            </Panel>
          )}

          {canManageMembers ? (
            <Panel title="Join Applications">
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
        </div>
      ) : null}
    </InspectShell>
  );
}

function PublicAllianceInspectSummary({
  alliance,
}: {
  alliance: Pick<ChainAllianceState["directory"][number], "description" | "name" | "tag" | "totalMemberScore">;
}) {
  return (
    <div className="grid gap-3">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded border border-cyan-300/35 bg-cyan-300/10 px-2 py-1 font-mono text-xs font-semibold leading-none text-cyan-100">
            {alliance.tag}
          </span>
          <h3 className="min-w-0 text-base font-semibold text-white">{alliance.name}</h3>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          {alliance.description || "No public alliance description."}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <CompactStat label="Total Score" value={formatScore(alliance.totalMemberScore)} />
      </div>
    </div>
  );
}

function InspectShell({ action, children, eyebrow, onBack, subtitle, title, titlePrefix }: {
  action?: ComponentChildren;
  children: ComponentChildren;
  eyebrow?: string | undefined;
  onBack: () => void;
  subtitle: string;
  title: string;
  titlePrefix?: ComponentChildren;
}) {
  return (
    <section className="min-h-0 overflow-auto">
      <div className="mx-auto grid w-full max-w-7xl gap-4 p-4">
        <PageHeader
          actions={action}
          beforeTitle={(
            <button className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-cyan-100" onClick={onBack} type="button">
              <ArrowLeft size={14} /> Back
            </button>
          )}
          bordered
          eyebrow={eyebrow}
          subtitle={subtitle}
          title={(
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              {titlePrefix}
              <span className="min-w-0 truncate">{title}</span>
            </span>
          )}
          titleSize="xl"
        />
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

function TransferOwnershipButton({ address, disabled, onTransferOwnership }: {
  address: string;
  disabled: boolean;
  onTransferOwnership: (playerAddress: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <>
        <button
          className="rounded border border-amber-300/40 px-2 py-1 text-xs font-semibold text-amber-100 disabled:opacity-50"
          disabled={disabled}
          onClick={() => { setConfirming(false); onTransferOwnership(address); }}
          type="button"
        >
          Confirm Transfer
        </button>
        <button
          className="rounded border border-white/10 px-2 py-1 text-xs font-semibold text-slate-100 hover:bg-white/10"
          onClick={() => setConfirming(false)}
          type="button"
        >
          Cancel
        </button>
      </>
    );
  }
  return (
    <button
      className="rounded border border-amber-300/30 px-2 py-1 text-xs font-semibold text-amber-100 disabled:opacity-50"
      disabled={disabled}
      onClick={() => setConfirming(true)}
      title="Hand the owner role to this officer"
      type="button"
    >
      Transfer Ownership
    </button>
  );
}

function RosterGroup({ canManageMembers, disabled, isOwner, members, onKick, onOpenPlayer, onSetRole, onTransferOwnership, viewer }: {
  canManageMembers: boolean;
  disabled: boolean;
  isOwner: boolean;
  members: RosterMember[];
  onKick: (playerAddress: string) => void;
  onOpenPlayer: (wallet: string) => void;
  onSetRole: (playerAddress: string, role: "member" | "officer") => void;
  onTransferOwnership: (playerAddress: string) => void;
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
        <span>Members</span>
        <span>{members.length}</span>
      </div>
      {members.length ? (
        <div className="grid gap-1.5">
          {visibleMembers.map((member) => {
            const isViewer = viewer?.toLowerCase() === member.address.toLowerCase();
            const canKick = canManageMembers && member.role === "member";
            const ownerCanChangeRole = isOwner && member.role !== "owner";
            const rowTone = memberRowTone(member, isViewer);
            return (
              <div className={`grid gap-2 rounded border px-2 py-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center ${rowTone}`} key={member.address}>
                <button className="min-w-0 text-left" onClick={() => onOpenPlayer(member.address)} type="button">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    {member.role === "owner" ? <Crown size={14} className="text-amber-200" /> : <UserRound size={14} className="text-slate-500" />}
                    <span className="font-mono text-sm text-white">{member.displayName?.trim() || shortAddress(member.address)}</span>
                    <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-300">{member.role}</span>
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    Score {formatScore(member.totalScore)} / Joined {formatUserTimestamp(member.joinedAt)}
                  </span>
                </button>
                {canManageMembers ? (
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    {ownerCanChangeRole && member.role === "member" ? <button className="rounded border border-white/10 px-2 py-1 text-xs font-semibold text-slate-100 disabled:opacity-50" disabled={disabled} onClick={() => onSetRole(member.address, "officer")} type="button">Make Officer</button> : null}
                    {ownerCanChangeRole && member.role === "officer" ? <button className="rounded border border-white/10 px-2 py-1 text-xs font-semibold text-slate-100 disabled:opacity-50" disabled={disabled} onClick={() => onSetRole(member.address, "member")} type="button">Make Member</button> : null}
                    {canTransferAllianceOwnership(member, isOwner, isViewer) ? <TransferOwnershipButton address={member.address} disabled={disabled} onTransferOwnership={onTransferOwnership} /> : null}
                    {(canKick || (isOwner && member.role === "officer")) && !isViewer ? <button className="rounded border border-red-300/30 px-2 py-1 text-xs font-semibold text-red-100 disabled:opacity-50" disabled={disabled} onClick={() => onKick(member.address)} type="button">Remove</button> : null}
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
        <p className="text-sm text-slate-400">No indexed public members are available.</p>
      )}
    </div>
  );
}

function memberRowTone(member: RosterMember, isViewer: boolean): string {
  if (isViewer) return "border-emerald-300/35 bg-emerald-300/[0.10]";
  if (member.role === "owner") return "border-amber-300/35 bg-amber-300/[0.10]";
  if (member.role === "officer") return "border-emerald-300/25 bg-emerald-300/[0.07]";
  return "border-white/10 bg-white/[0.03]";
}

function CompactStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5 rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-xs">
      <span className="shrink-0 font-semibold uppercase text-slate-500">{label}</span>
      <span className="min-w-0 truncate font-mono text-slate-100">{value}</span>
    </span>
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

export function playerInspectScoreItems(highscore: HighscoreEntry | null): Array<{ label: string; value: string }> {
  if (!highscore) return [];
  return [
    { label: "Total", value: formatScore(highscore.score.total) },
    { label: "Economy", value: formatScore(highscore.score.economy) },
    { label: "Military", value: formatScore(highscore.score.military) },
    { label: "Fleet", value: formatScore(highscore.score.fleet) },
    { label: "Defense", value: formatScore(highscore.score.defense) },
    { label: "Research", value: formatScore(highscore.score.research) },
    { label: "Research Lvls", value: formatScore(highscore.score.researchLevels) },
    { label: "Ships", value: formatScore(highscore.score.fleetCount) },
  ];
}

export function playerProfileHomePlanetLabel(
  planets: WalletPlanetsResponse | null,
  highscore: HighscoreEntry | null,
): string | undefined {
  const homePlanetId = highscore?.homePlanetId ?? planets?.homePlanetId ?? null;
  const indexedHomePlanet = homePlanetId
    ? planets?.planets.find((planet) => planet.planetId === homePlanetId)
    : undefined;
  if (indexedHomePlanet) return coordinateLabel(indexedHomePlanet);

  const highscoreHomePlanet = homePlanetId
    ? [
        ...(highscore?.planets ?? []),
        ...(highscore?.homePlanet ? [highscore.homePlanet] : []),
      ].find((planet) => planet.planetId === homePlanetId)
    : highscore?.homePlanet ?? undefined;
  if (highscoreHomePlanet) return coordinateLabel(highscoreHomePlanet.coordinates);

  const firstIndexedPlanet = planets?.planets[0];
  if (firstIndexedPlanet) return coordinateLabel(firstIndexedPlanet);

  const firstHighscorePlanet = highscore?.planets?.[0] ?? highscore?.homePlanet ?? undefined;
  if (firstHighscorePlanet) return coordinateLabel(firstHighscorePlanet.coordinates);

  return undefined;
}

export function playerPlanetTacticalSignals(
  planet: ManagedPlanetResponse,
  originCoords: Coordinates | undefined,
  attackProtection: HighscoreEntry["attackProtection"] | null,
): Array<{ label: string; value: string }> {
  const protectionSignal = attackProtection && !attackProtection.allowed && attackProtection.blockedReason !== "none"
    ? [{ label: "Protection", value: attackProtection.blockedReasonLabel ?? "Protected" }]
    : [];

  return [
    { label: "Distance", value: originCoords ? fleetMissionDistance(originCoords, planet).toLocaleString("en-US") : "Home planet unavailable" },
    { label: "Resources", value: formatResources(planet.tactical?.raidableResources ?? planet.resources) },
    ...protectionSignal,
    { label: "Ships", value: planetTacticalUnitSignal(planet.tactical?.ships) },
    { label: "Defenses", value: planetTacticalUnitSignal(planet.tactical?.defenses) },
    { label: "Fields", value: `${planet.fieldsUsed}/${planet.fieldsCapacity}` },
    { label: "Queues", value: planetQueueSignal(planet) },
    { label: "Moon", value: planet.moon?.exists ? "Yes" : "No" },
  ];
}

export function playerInspectPlanetImage(planet: Pick<ManagedPlanetResponse, "temperature">): string {
  return planetImageForType(planetTypeFromTemperature(planet.temperature));
}

function coordinateLabel(coordinates: Coordinates): string {
  return `[${coordinates.galaxy}:${coordinates.system}:${coordinates.position}]`;
}

function formatResources(resources: OnChainResources): string {
  return `${formatShortNumber(resources.metal)} M / ${formatShortNumber(resources.crystal)} C / ${formatShortNumber(resources.deuterium)} D`;
}

function formatShortNumber(value: string): string {
  try {
    const number = BigInt(value);
    if (number >= 1_000_000_000n) return `${(Number(number / 100_000_000n) / 10).toLocaleString("en-US")}B`;
    if (number >= 1_000_000n) return `${(Number(number / 100_000n) / 10).toLocaleString("en-US")}M`;
    if (number >= 1_000n) return `${(Number(number / 100n) / 10).toLocaleString("en-US")}K`;
    return number.toLocaleString("en-US");
  } catch {
    return value;
  }
}

function planetTacticalUnitSignal(unit: { count: number; power: string } | undefined): string {
  if (!unit) return "Unavailable";
  const count = unit.count.toLocaleString("en-US");
  const power = formatShortNumber(unit.power);
  return unit.count === 1 ? `${count} unit / ${power} power` : `${count} units / ${power} power`;
}

function planetQueueSignal(planet: ManagedPlanetResponse): string {
  const active = [
    planet.queues.building?.active ? "Building" : null,
    planet.queues.ship?.active ? "Shipyard" : null,
    planet.queues.defense?.active ? "Defense" : null,
  ].filter(Boolean);
  return active.length ? active.join(", ") : "Idle";
}
