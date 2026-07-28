import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  Activity,
  ArrowUpRight,
  Blocks,
  Bot,
  Crosshair,
  ExternalLink,
  Globe2,
  Orbit,
  Radio,
  Rocket,
  Shield,
  Sparkles,
  Users
} from "lucide-preact";
import "./styles.css";

const apiUrl = (import.meta.env.VITE_VEYDRIFT_API_URL as string | undefined) ?? "https://api.veydrift.com";

interface Stats {
  generatedAt: string;
  coverage: { fromBlock: number; throughBlock: number; fromTimestamp: number; throughTimestamp: number };
  summary: {
    players: number;
    newPlayers24h: number;
    newPlayers7d: number;
    activePlayers24h: number;
    activePlayers7d: number;
    planets: number;
    colonies: number;
    transactions: number;
    events: number;
    fleetMissions: number;
    battles: number;
    alliances: number;
  };
  daily: Array<{ date: string; transactions: number; events: number; newPlayers: number }>;
  contracts: Array<{ address: string; label: string; transactions: number; events: number }>;
  topEvents: Array<{ name: string; transactions: number; events: number }>;
}

const number = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function niceEventName(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function ActivityChart({ daily }: { daily: Stats["daily"] }) {
  const width = 920;
  const height = 270;
  const inset = 18;
  const max = Math.max(...daily.map((item) => item.transactions), 1);
  const points = daily.map((item, index) => ({
    ...item,
    x: inset + index * ((width - inset * 2) / Math.max(daily.length - 1, 1)),
    y: height - inset - (item.transactions / max) * (height - inset * 2)
  }));
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${inset},${height - inset} ${line} ${width - inset},${height - inset}`;

  return (
    <div class="chart-shell">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily onchain transactions">
        <defs>
          <linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#57f2dd" stop-opacity=".32" />
            <stop offset="100%" stop-color="#57f2dd" stop-opacity="0" />
          </linearGradient>
          <linearGradient id="activity-line" x1="0" x2="1">
            <stop stop-color="#57f2dd" />
            <stop offset="1" stop-color="#a795ff" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line x1={inset} x2={width - inset} y1={height * ratio} y2={height * ratio} class="grid-line" />
        ))}
        <polygon points={area} fill="url(#activity-fill)" />
        <polyline points={line} fill="none" stroke="url(#activity-line)" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" />
        {points.map((point) => point.newPlayers > 0 && (
          <circle cx={point.x} cy={point.y} r={5 + Math.min(point.newPlayers, 4)} class="join-dot">
            <title>{`${point.date}: ${number.format(point.transactions)} tx · ${point.newPlayers} new commander${point.newPlayers === 1 ? "" : "s"}`}</title>
          </circle>
        ))}
      </svg>
      <div class="chart-axis">
        <span>{daily[0]?.date.slice(5)}</span>
        <span>{daily[Math.floor(daily.length / 2)]?.date.slice(5)}</span>
        <span>{daily.at(-1)?.date.slice(5)}</span>
      </div>
    </div>
  );
}

function StatCard({ label, value, note, icon: Icon, accent = "cyan" }: {
  label: string;
  value: number;
  note: string;
  icon: typeof Users;
  accent?: string;
}) {
  return (
    <article class={`stat-card ${accent}`}>
      <div class="stat-icon"><Icon size={18} /></div>
      <div class="stat-label">{label}</div>
      <div class="stat-value">{number.format(value)}</div>
      <div class="stat-note">{note}</div>
    </article>
  );
}

function App() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`${apiUrl}/stats`);
        if (!response.ok) throw new Error(`Telemetry unavailable (${response.status})`);
        const next = await response.json() as Stats;
        if (active) {
          setStats(next);
          setError(null);
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Telemetry unavailable");
      }
    };
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const peak = useMemo(
    () => stats ? Math.max(...stats.contracts.map((contract) => contract.transactions), 1) : 1,
    [stats]
  );

  return (
    <main>
      <div class="stars" />
      <nav>
        <a href="https://veydrift.com" class="brand" aria-label="Veydrift">
          <span class="brand-mark"><Orbit size={21} /></span>
          <span>VEYDRIFT</span>
          <span class="brand-sub">INTELLIGENCE</span>
        </a>
        <div class="nav-actions">
          <span class="network"><i /> BASE MAINNET</span>
          <a href="https://veydrift.com" class="enter-link">Enter universe <ArrowUpRight size={15} /></a>
        </div>
      </nav>

      <section class="hero">
        <div class="hero-copy">
          <div class="eyebrow"><Radio size={14} /> LIVE UNIVERSE TELEMETRY</div>
          <h1>Every move leaves<br /><em>a signal.</em></h1>
          <p>Explore the onchain pulse of a persistent space empire—commanders joining, fleets moving, worlds growing, and battles resolving in real time.</p>
          {stats && (
            <div class="live-line">
              <span class="pulse" />
              Indexed through Base block <strong>{number.format(stats.coverage.throughBlock)}</strong>
              <span class="separator">/</span>
              updating every 30s
            </div>
          )}
        </div>
        <div class="orbital">
          <div class="planet">
            <span class="continent one" /><span class="continent two" /><span class="continent three" />
          </div>
          <span class="orbit-line line-one"><i /></span>
          <span class="orbit-line line-two"><i /></span>
          <div class="orbital-label label-one"><span>ACTIVE 24H</span><strong>{stats ? stats.summary.activePlayers24h : "—"}</strong></div>
          <div class="orbital-label label-two"><span>MISSIONS</span><strong>{stats ? compact.format(stats.summary.fleetMissions) : "—"}</strong></div>
        </div>
      </section>

      {error && !stats && <div class="error-panel">{error}. Retrying automatically.</div>}
      {!stats && !error && <div class="loading"><span /><span /><span /> Acquiring telemetry</div>}

      {stats && (
        <>
          <section class="stats-grid">
            <StatCard label="COMMANDERS" value={stats.summary.players} note={`+${stats.summary.newPlayers7d} this week`} icon={Users} />
            <StatCard label="ONCHAIN TXS" value={stats.summary.transactions} note={`${compact.format(stats.summary.events)} contract events`} icon={Blocks} accent="violet" />
            <StatCard label="COLONIZED WORLDS" value={stats.summary.planets} note={`${stats.summary.colonies} expansion colonies`} icon={Globe2} accent="amber" />
            <StatCard label="BATTLES RESOLVED" value={stats.summary.battles} note={`${compact.format(stats.summary.fleetMissions)} fleets launched`} icon={Crosshair} accent="red" />
          </section>

          <section class="panel activity-panel">
            <header class="panel-header">
              <div>
                <span class="section-kicker">NETWORK PULSE</span>
                <h2>Onchain activity</h2>
              </div>
              <div class="legend"><i class="line-key" /> Transactions <i class="dot-key" /> New commanders</div>
            </header>
            <ActivityChart daily={stats.daily} />
            <div class="mini-stats">
              <div><span>Active commanders · 24h</span><strong>{stats.summary.activePlayers24h}</strong></div>
              <div><span>Active commanders · 7d</span><strong>{stats.summary.activePlayers7d}</strong></div>
              <div><span>New commanders · 24h</span><strong>+{stats.summary.newPlayers24h}</strong></div>
              <div><span>New commanders · 7d</span><strong>+{stats.summary.newPlayers7d}</strong></div>
            </div>
          </section>

          <div class="lower-grid">
            <section class="panel">
              <header class="panel-header">
                <div><span class="section-kicker">CONTRACT MATRIX</span><h2>Transaction gravity</h2></div>
                <Activity size={21} />
              </header>
              <div class="contract-list">
                {stats.contracts.slice(0, 8).map((contract, index) => (
                  <a class="contract-row" href={`https://basescan.org/address/${contract.address}`} target="_blank" rel="noreferrer">
                    <span class="rank">{String(index + 1).padStart(2, "0")}</span>
                    <span class="contract-info"><strong>{contract.label}</strong><small>{shortAddress(contract.address)}</small></span>
                    <span class="bar"><i style={{ width: `${Math.max(2, contract.transactions / peak * 100)}%` }} /></span>
                    <span class="contract-total">{compact.format(contract.transactions)}<small>TXS</small></span>
                    <ExternalLink size={13} />
                  </a>
                ))}
              </div>
            </section>

            <section class="panel">
              <header class="panel-header">
                <div><span class="section-kicker">EVENT STREAM</span><h2>What the universe does</h2></div>
                <Sparkles size={21} />
              </header>
              <div class="event-list">
                {stats.topEvents.slice(0, 8).map((event, index) => (
                  <div class="event-row">
                    <span class={`event-symbol symbol-${index % 4}`}>
                      {index % 4 === 0 ? <Globe2 /> : index % 4 === 1 ? <Rocket /> : index % 4 === 2 ? <Shield /> : <Bot />}
                    </span>
                    <span><strong>{niceEventName(event.name)}</strong><small>{number.format(event.events)} events emitted</small></span>
                    <b>{compact.format(event.transactions)}</b>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <footer>
            <div><span class="pulse" /> LIVE FROM BASE</div>
            <p>Canonical onchain telemetry from blocks {number.format(stats.coverage.fromBlock)}–{number.format(stats.coverage.throughBlock)}. One transaction may emit several events.</p>
            <span>{new Date(stats.generatedAt).toLocaleString()}</span>
          </footer>
        </>
      )}
    </main>
  );
}

render(<App />, document.getElementById("app")!);
