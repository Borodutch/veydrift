import { ArrowLeft, Crown, RefreshCw, Shield, UserRound } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { formatUserTimestamp } from "../timestampFormat";
import type { Coordinates } from "../types";
import {
  fetchPlayerHighscore,
  fetchWalletPlanets,
  shortAddress,
  type ChainAllianceState,
  type HighscoreEntry,
  type WalletPlanetsResponse,
} from "../walletFlow";
import {
  allianceDisplayName,
  buildAllianceRoster,
  findAllianceEntry,
  currentAllianceEntry,
  playerLabel,
} from "./AlliancePage";
import { VeydriftLoader } from "./VeydriftLoader";

type PlayerInspectState =
  | { status: "idle" }
  | { status: "loading"; wallet: string }
  | { status: "loaded"; wallet: string; planets: WalletPlanetsResponse | null; highscore: HighscoreEntry | null }
  | { status: "error"; wallet: string; label: string };

type AllianceActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

export function PlayerInspectPage({
  apiBaseUrl,
  wallet,
  onBack,
  onOpenAlliance,
  onOpenPlanet,
}: {
  apiBaseUrl?: string | undefined;
  wallet: string | null;
  onBack: () => void;
  onOpenAlliance: (allianceId: string) => void;
  onOpenPlanet: (coords: Coordinates) => void;
}) {
  const [profile, setProfile] = useState<PlayerInspectState>({ status: "idle" });

  useEffect(() => {
    if (!wallet) {
      setProfile({ status: "idle" });
      return;
    }

    if (!apiBaseUrl) {
      setProfile({ status: "error", wallet, label: "Game API unavailable." });
      return;
    }

    let disposed = false;
    setProfile({ status: "loading", wallet });
    Promise.allSettled([
      fetchWalletPlanets(apiBaseUrl, wallet),
      fetchPlayerHighscore(apiBaseUrl, wallet),
    ]).then(([planetsResult, highscoreResult]) => {
      if (disposed) return;
      const planets = planetsResult.status === "fulfilled" ? planetsResult.value : null;
      const highscore = highscoreResult.status === "fulfilled" ? highscoreResult.value : null;
      if (!planets && !highscore) {
        const reason = planetsResult.status === "rejected" && planetsResult.reason instanceof Error
          ? planetsResult.reason.message
          : "Player profile could not be loaded.";
        setProfile({ status: "error", wallet, label: reason });
        return;
      }
      setProfile({ status: "loaded", wallet, planets, highscore });
    });

    return () => {
      disposed = true;
    };
  }, [apiBaseUrl, wallet]);

  const displayName = profile.status === "loaded"
    ? profile.planets?.player?.displayName ?? profile.highscore?.displayName ?? null
    : null;
  const alliance = profile.status === "loaded" ? profile.highscore?.alliance ?? null : null;
  const planets = profile.status === "loaded" ? profile.planets?.planets ?? [] : [];

  return (
    <section className="min-h-0 overflow-auto bg-[#080d16]">
      <div className="mx-auto grid w-full max-w-6xl gap-4 p-4">
        <InspectHeader
          eyebrow="Player Inspect"
          icon={<UserRound size={16} />}
          onBack={onBack}
          subtitle={wallet ? shortAddress(wallet) : "No player selected"}
          title={displayName?.trim() || (wallet ? shortAddress(wallet) : "Player")}
        />

        {!wallet ? (
          <Notice>Select a commander from rankings, alliance roster, or public intel to inspect player state.</Notice>
        ) : null}
        {profile.status === "loading" ? <VeydriftLoader label="Loading player inspect" /> : null}
        {profile.status === "error" ? <Notice tone="error">{profile.label}</Notice> : null}

        {wallet && profile.status !== "loading" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid gap-4">
              <Panel title="Commander">
                <div className="grid gap-3">
                  <div className="rounded border border-white/10 bg-black/20 p-3">
                    <p className="font-mono text-sm text-white">{displayName?.trim() || shortAddress(wallet)}</p>
                    <p className="mt-1 break-all text-xs text-slate-500">{wallet}</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <MiniStat label="Rank" value={formatRank(profile.status === "loaded" ? profile.highscore?.rank : undefined)} />
                    <MiniStat label="Planets" value={String(planets.length)} />
                    <MiniStat label="Total Score" value={formatScore(profile.status === "loaded" ? profile.highscore?.score.total : undefined)} />
                  </div>
                  {alliance ? (
                    <button
                      className="rounded border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-left text-sm text-cyan-50 hover:bg-cyan-300/15"
                      onClick={() => onOpenAlliance(alliance.allianceId)}
                      type="button"
                    >
                      Alliance <span className="font-mono">[{alliance.tag}]</span> {alliance.name}
                    </button>
                  ) : (
                    <p className="rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-400">
                      No public alliance membership is indexed for this commander.
                    </p>
                  )}
                </div>
              </Panel>

              <Panel title="Planets">
                {planets.length ? (
                  <div className="grid gap-2">
                    {planets.map((planet) => (
                      <button
                        className="grid gap-2 rounded border border-white/10 bg-black/20 px-3 py-2 text-left transition hover:border-cyan-200/40 hover:bg-white/[0.06] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                        key={planet.planetId}
                        onClick={() => onOpenPlanet({ galaxy: planet.galaxy, system: planet.system, position: planet.position })}
                        type="button"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-white">{planet.name || `Planet #${planet.planetId}`}</span>
                          <span className="mt-1 block text-xs text-slate-500">
                            [{planet.galaxy}:{planet.system}:{planet.position}] / {planet.fieldsUsed}/{planet.fieldsCapacity} fields
                          </span>
                        </span>
                        <span className="font-mono text-xs text-cyan-100">{planet.isHomePlanet ? "Home" : `#${planet.planetId}`}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No indexed planets are available for this wallet yet.</p>
                )}
              </Panel>
            </div>

            <Panel title="Scores">
              {profile.status === "loaded" && profile.highscore ? (
                <div className="grid grid-cols-2 gap-2">
                  {scoreRows(profile.highscore).map((row) => (
                    <MiniStat key={row.label} label={row.label} value={row.value} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No public highscore entry is indexed for this commander.</p>
              )}
            </Panel>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function AllianceInspectPage({
  actionState,
  allianceState,
  canTransact,
  error,
  loading,
  selectedAllianceId,
  onBack,
  onCancelJoinRequest,
  onJoinRequest,
  onOpenPlayer,
  onRefresh,
}: {
  actionState: AllianceActionState;
  allianceState: ChainAllianceState | null;
  canTransact: boolean;
  error?: string | undefined;
  loading: boolean;
  selectedAllianceId: string | null;
  onBack: () => void;
  onCancelJoinRequest: (allianceId: string) => void;
  onJoinRequest: (allianceId: string) => void;
  onOpenPlayer: (playerAddress: string) => void;
  onRefresh: () => void;
}) {
  const roster = useMemo(
    () => buildAllianceRoster(allianceState?.members ?? [], allianceState?.profile?.owner),
    [allianceState?.members, allianceState?.profile?.owner]
  );
  const currentAlliance = useMemo(
    () => currentAllianceEntry(allianceState, roster.all.length),
    [allianceState, roster.all.length]
  );
  const alliance = findAllianceEntry(allianceState?.directory ?? [], selectedAllianceId, currentAlliance);
  const currentAllianceId = allianceState?.membership.allianceId ?? "0";
  const isCurrentAlliance = Boolean(alliance && alliance.allianceId === currentAllianceId);
  const pendingJoinRequests = new Set((allianceState?.pendingJoinRequests ?? []).map((request) => request.allianceId));
  const pending = Boolean(alliance && pendingJoinRequests.has(alliance.allianceId));
  const canRequestJoin = Boolean(alliance && currentAllianceId === "0");
  const disabled = !canTransact || loading || actionState.status === "pending";

  return (
    <section className="min-h-0 overflow-auto bg-[#080d16]">
      <div className="mx-auto grid w-full max-w-6xl gap-4 p-4">
        <InspectHeader
          action={(
            <button className="icon-button" disabled={loading} onClick={onRefresh} title="Refresh alliance state" type="button">
              <RefreshCw size={16} />
            </button>
          )}
          eyebrow="Alliance Inspect"
          icon={<Shield size={16} />}
          onBack={onBack}
          subtitle={alliance ? `Alliance #${alliance.allianceId}` : "No alliance selected"}
          title={alliance ? allianceDisplayName(alliance) : "Alliance"}
        />

        {error ? <Notice tone="error">{error}</Notice> : null}
        {actionState.status !== "idle" ? <Notice tone={actionState.status === "error" ? "error" : "info"}>{actionState.label}</Notice> : null}
        {loading && !allianceState ? <VeydriftLoader label="Loading alliance inspect" /> : null}

        {alliance ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid gap-4">
              <Panel title="Profile">
                <div className="grid gap-3">
                  <div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="rounded border border-cyan-300/35 bg-cyan-300/10 px-2 py-1 font-mono text-xs font-semibold text-cyan-100">
                        {alliance.tag}
                      </span>
                      <h2 className="min-w-0 text-lg font-semibold text-white">{alliance.name}</h2>
                      {!alliance.active ? <span className="text-xs font-semibold uppercase text-amber-100">Inactive</span> : null}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{alliance.description || "No public alliance description."}</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <MiniStat label="Members" value={String(alliance.memberCount)} />
                    <MiniStat label="Created" value={formatUserTimestamp(alliance.createdAt)} />
                    <MiniStat label="Roster" value={isCurrentAlliance ? "Available" : "Private"} />
                  </div>
                  <button
                    className="rounded border border-white/10 bg-black/20 px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10"
                    onClick={() => onOpenPlayer(alliance.owner)}
                    type="button"
                  >
                    Owner <span className="font-mono text-cyan-100">{playerLabel(alliance.ownerDisplayName, alliance.owner)}</span>
                  </button>
                  {canRequestJoin ? (
                    <button
                      className="w-fit rounded border border-cyan-300/25 px-3 py-2 text-sm font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={disabled}
                      onClick={() => pending ? onCancelJoinRequest(alliance.allianceId) : onJoinRequest(alliance.allianceId)}
                      type="button"
                    >
                      {pending ? "Cancel Request" : "Request Join"}
                    </button>
                  ) : null}
                </div>
              </Panel>

              <Panel title="Roster">
                {isCurrentAlliance && roster.all.length ? (
                  <div className="grid gap-2">
                    {roster.all.map((member) => (
                      <button
                        className="grid gap-1 rounded border border-white/10 bg-black/20 px-3 py-2 text-left hover:border-cyan-200/40 hover:bg-white/[0.06]"
                        key={member.address}
                        onClick={() => onOpenPlayer(member.address)}
                        type="button"
                      >
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          {member.role === "owner" ? <Crown size={14} className="text-amber-200" /> : <UserRound size={14} className="text-slate-500" />}
                          <span className="font-mono text-sm text-white">{playerLabel(member.displayName, member.address)}</span>
                          <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-300">
                            {member.role}
                          </span>
                        </span>
                        <span className="text-xs text-slate-500">Joined {formatUserTimestamp(member.joinedAt)}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">
                    Full roster is available for your current alliance. Other alliances expose owner, profile, and member count.
                  </p>
                )}
              </Panel>
            </div>

            <Panel title="Directory Context">
              <div className="grid gap-2">
                <MiniStat label="Known Alliances" value={String(allianceState?.directory.length ?? 0)} />
                <MiniStat label="Your Alliance" value={currentAllianceId === "0" ? "None" : `#${currentAllianceId}`} />
                <MiniStat label="Join Request" value={pending ? "Pending" : "None"} />
              </div>
            </Panel>
          </div>
        ) : loading ? null : (
          <Notice>Select an alliance from rankings, galaxy intel, or the alliance directory to inspect its public profile.</Notice>
        )}
      </div>
    </section>
  );
}

function InspectHeader({
  action,
  eyebrow,
  icon,
  onBack,
  subtitle,
  title,
}: {
  action?: ComponentChildren;
  eyebrow: string;
  icon: ComponentChildren;
  onBack: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-white/10 pb-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <button
          className="mb-3 inline-flex h-8 items-center gap-2 rounded border border-white/10 px-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200/70">
          {icon}
          {eyebrow}
        </p>
        <h1 className="mt-1 truncate text-2xl font-semibold text-white">{title}</h1>
        <p className="mt-1 truncate text-sm text-slate-400">{subtitle}</p>
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </header>
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

function formatRank(rank: number | undefined): string {
  return rank ? `#${rank}` : "Unranked";
}

function formatScore(value: string | undefined): string {
  if (!value) return "0";
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    return value;
  }
}

function scoreRows(entry: HighscoreEntry): Array<{ label: string; value: string }> {
  return [
    { label: "Total", value: formatScore(entry.score.total) },
    { label: "Economy", value: formatScore(entry.score.economy) },
    { label: "Research", value: formatScore(entry.score.research) },
    { label: "Military", value: formatScore(entry.score.military) },
    { label: "Fleet", value: formatScore(entry.score.fleet) },
    { label: "Defense", value: formatScore(entry.score.defense) },
  ];
}
