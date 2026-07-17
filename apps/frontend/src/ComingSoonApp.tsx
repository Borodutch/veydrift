import { useEffect, useState } from "preact/hooks";
import {
  Activity,
  ArrowRight,
  Coins,
  ExternalLink,
  Factory,
  FileText,
  Orbit,
  Radio,
  Rocket,
  Users,
} from "lucide-preact";
import { RetroCdBoxHero } from "./components/RetroCdBoxHero";
import { TELEGRAM_SUPPORT_URL } from "./supportLinks";
import { playableApiUrl } from "./runtimeConfig";

const alphaUrl = "https://test.veydrift.com";
const playUrl = "/play";
const faucetUrl = "https://docs.base.org/base-chain/network-information/network-faucets";
export const whitepaperUrl = "/whitepaper.pdf";
export const landingFeedRefreshMs = 60_000;
export const landingAllianceRefreshMs = 300_000;

const ships = {
  colonyShip: "/assets/game/style-pass/generated/ships/colony-ship.webp",
};

const planets = {
  crystal: "/assets/game/style-pass/generated/planets/crystal-violet.webp",
};

const assets = {
  rift: "/assets/game/style-pass/generated/buildings/interdimensional-rift-stabilizer-mid.webp",
  plasma: "/assets/game/style-pass/generated/research/plasma.webp",
};

const screenshots = [
  {
    title: "Command an empire",
    body: "Claim worlds, grow production, queue upgrades and keep every front under control.",
    src: "/assets/landing/qa-screens/overview-desktop.jpg",
  },
  {
    title: "Build ships and logistics",
    body: "Every fleet starts with real production and inventory at the selected planet.",
    src: "/assets/landing/qa-screens/shipyard-desktop.jpg",
  },
  {
    title: "Fight over public space",
    body: "Read the galaxy, mark prey, launch attacks and punish exposed rivals.",
    src: "/assets/landing/qa-screens/missions-desktop.jpg",
  },
] as const;

const howItWorks = [
  {
    icon: Factory,
    title: "Build planets",
    body: "Settle worlds, expand mines, unlock research and turn production into conquest capacity.",
  },
  {
    icon: Rocket,
    title: "Launch fleets",
    body: "Send cargo, plant colonies, harvest debris and strike targets across a persistent universe.",
  },
  {
    icon: Coins,
    title: "Move value through the Rift",
    body: "Extract ERC20 Metal, Crystal and Deuterium, trade them, then import resources when war demands it.",
  },
] as const;

type LandingAlliance = {
  members: number;
  name: string;
  score: string;
  tag: string;
};

type LandingHighscoreEntry = {
  alliance?: {
    allianceId: string;
    name: string;
    tag: string;
  } | null;
  score: {
    total: string;
  };
  totalUserScore?: string;
  wallet?: string;
};

type LandingFeedTone = "amber" | "cyan" | "emerald" | "rose";

type LandingFeedItem = {
  label: string;
  tone: LandingFeedTone;
  value: string;
};

type LandingLoadStatus = "empty" | "loading" | "offline" | "ready";

type LandingLaunchCta = {
  eyebrow: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref: string;
  secondaryLabel: string;
  supportCopy: string;
  showFaucet: boolean;
};

type LandingMissionPlanet = {
  coordinates?: string;
  galaxy?: number;
  name?: string | null;
  position?: number;
  system?: number;
};

type LandingFleetMission = {
  arrivalAt: string;
  missionId: string;
  missionType: string;
  originPlanet?: LandingMissionPlanet | null;
  originPlanetId: string;
  owner: string;
  returnAt: string;
  status: string;
  targetPlanet?: LandingMissionPlanet | null;
  targetPlanetId: string;
};

export function ComingSoonApp() {
  useLandingScrollParallax();

  return (
    <main className="landing-page min-h-dvh overflow-hidden bg-void text-white">
      <HeroSection />
      <ScreenshotsSection />
      <HowItWorksSection />
      <RiftSection />
      <FeedSection />
      <AlliancesSection />
      <AlphaSection />
    </main>
  );
}

function useLandingScrollParallax() {
  useEffect(() => {
    let ticking = false;
    const update = () => {
      document.documentElement.style.setProperty("--landing-scroll", String(window.scrollY));
      ticking = false;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
}

function HeroSection() {
  const launch = landingLaunchCtaForLocation();

  return (
    <RetroCdBoxHero ariaLabel="Veydrift landing" stage="section">
      <div className="landing-cd-copy">
        <p className="landing-cd-eyebrow">{launch.eyebrow}</p>
        <h1>Veydrift</h1>
        <p>
          Take command in a vast onchain universe. Build the economy, marshal fleets,
          coordinate with alliance members and turn the Rift into a weapon of conquest.
        </p>
        <div className="landing-cd-actions">
          <a className="landing-cd-primary" href={launch.primaryHref}>
            {launch.primaryLabel}
            <ArrowRight className="h-4 w-4" />
          </a>
          <a className="landing-cd-secondary" href={launch.secondaryHref}>
            {launch.secondaryLabel}
            <Orbit className="h-4 w-4" />
          </a>
          <a
            className="landing-cd-secondary"
            href={whitepaperUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            Whitepaper
            <FileText className="h-4 w-4" />
          </a>
        </div>
        <p className="landing-cd-support">{launch.supportCopy}</p>
      </div>
    </RetroCdBoxHero>
  );
}

function ScreenshotsSection() {
  return (
    <section className="relative bg-[#05070d] px-5 py-16 sm:px-8 lg:px-10">
      <div className="relative z-10 mx-auto max-w-7xl">
        <div className="grid gap-5 lg:grid-cols-[0.78fr_1.22fr] lg:items-end">
          <div>
            <h2 className="text-3xl font-semibold leading-tight text-white sm:text-5xl">
              Command planets, build fleets, scan galaxies and conquer with your alliance.
            </h2>
          </div>
        </div>

        <div className="mt-9 grid gap-4 lg:grid-cols-3">
          {screenshots.map((shot, index) => (
            <article
              className={`landing-screenshot-frame ${index === 1 ? "lg:mt-10" : index === 2 ? "lg:mt-20" : ""}`}
              key={shot.title}
            >
              <img alt={`${shot.title} screenshot`} src={shot.src} />
              <div>
                <h3>{shot.title}</h3>
                <p>{shot.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section id="how-it-works" className="relative overflow-hidden bg-[#08100e] px-5 py-18 sm:px-8 lg:px-10">
      <img
        alt=""
        className="landing-layer landing-layer-research right-[-3rem] top-12 hidden w-72 opacity-35 md:block"
        src={assets.plasma}
      />
      <div className="mx-auto max-w-7xl">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold text-signal">How the game works</p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight text-white sm:text-5xl">
            Classic space empire pressure, rebuilt for commanders who want ownership.
          </h2>
        </div>
        <div className="mt-9 grid gap-4 md:grid-cols-3">
          {howItWorks.map((item) => {
            const Icon = item.icon;
            return (
              <article className="landing-feature" key={item.title}>
                <Icon className="h-5 w-5 text-signal" />
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function RiftSection() {
  return (
    <section className="relative overflow-hidden bg-[#0b0a08] px-5 py-24 sm:px-8 sm:py-28 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:gap-16">
        <div className="relative min-h-[30rem] overflow-hidden rounded-lg border border-ember/[0.08] bg-[#130f0a]">
          <img
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-88"
            src={assets.rift}
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(19,15,10,0.94)_0%,rgba(19,15,10,0.46)_56%,rgba(19,15,10,0.18)_100%)]" />
          <div className="relative z-10 flex h-full min-h-[30rem] flex-col justify-end p-6 sm:p-9">
            <p className="text-sm font-semibold text-ember">Resource bridge</p>
            <h2 className="mt-3 max-w-xl text-3xl font-semibold leading-tight text-white sm:text-5xl">
              Extract resources out of the universe. Import them back when strategy demands it.
            </h2>
          </div>
        </div>

        <div className="lg:py-8">
          <p className="max-w-2xl text-lg leading-8 text-slate-300">
            Veydrift resources are ERC20 tokens: Metal, Crystal and Deuterium. The Rift is designed
            to become the bridge between in-game production and open markets.
          </p>
          <div className="mt-10 grid gap-4">
            <RiftPoint title="Extract" body="Move surplus production into tradeable resource tokens." />
            <RiftPoint title="Trade" body="Price resources in the open instead of locking value inside a closed game server." />
            <RiftPoint title="Import" body="Bring resources back onchain to rebuild fleets, rush strategy or recover after a battle." />
          </div>
        </div>
      </div>
    </section>
  );
}

function RiftPoint({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-ember/[0.07] bg-ember/[0.052] p-5">
      <h3 className="text-sm font-semibold text-ember">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-300">{body}</p>
    </div>
  );
}

function FeedSection() {
  const feed = useLandingFeed();

  return (
    <section className="relative overflow-hidden bg-[#05070d] px-5 py-18 sm:px-8 lg:px-10">
      <img
        alt=""
        className="landing-layer landing-layer-ship left-[-1rem] top-12 w-44 rotate-[12deg] opacity-45 md:w-64"
        src={ships.colonyShip}
      />
      <div className="relative z-10 mx-auto max-w-4xl">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold text-signal">Universe intelligence</p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight text-white sm:text-5xl">
            The universe is always alive with movement, pressure and opportunity.
          </h2>
        </div>

        <div className="mt-9 rounded-lg border border-white/[0.045] bg-[#0d1320] p-3 shadow-[0_20px_90px_rgba(0,0,0,0.38)]">
          <div className="flex items-center justify-between border-b border-white/[0.04] px-3 py-3">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-signal" />
              <h3 className="text-sm font-semibold text-white">Live alpha feed</h3>
            </div>
            <LandingStatusPill status={feed.status} />
          </div>
          <div className="grid gap-2 p-3">
            {feed.items.length > 0
              ? feed.items.map((item) => <LandingFeedRow item={item} key={item.value} />)
              : (
                <LandingFeedRow
                  item={{
                    label: feed.status === "loading" ? "Syncing indexed missions" : "No active fleet movement",
                    tone: feed.status === "offline" ? "amber" : "cyan",
                    value: landingFeedEmptyCopy(feed.status),
                  }}
                />
              )}
          </div>
        </div>
      </div>
    </section>
  );
}

function AlphaSection() {
  const launch = landingLaunchCtaForLocation();

  return (
    <section className="relative overflow-hidden bg-[#0a0d13] px-5 py-24 sm:px-8 sm:py-28 lg:px-10">
      <img
        alt=""
        className="landing-layer landing-layer-planet left-[62%] top-8 w-72 opacity-38 md:w-96"
        src={planets.crystal}
      />
      <div className="relative z-10 mx-auto max-w-7xl overflow-hidden rounded-lg border border-signal/[0.08] bg-[linear-gradient(135deg,rgba(128,241,255,0.13),rgba(246,179,92,0.08)_42%,rgba(9,14,24,0.94))] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.42)] sm:p-9 lg:p-12">
        <div className="max-w-4xl">
          <p className="text-sm font-semibold text-ember">Enter the alpha</p>
          <h2 className="mt-3 text-4xl font-semibold leading-tight text-white sm:text-6xl">
            Claim your first planet.
          </h2>
        </div>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <a
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-signal/30 bg-signal px-5 py-3 text-sm font-semibold text-[#031014] shadow-[0_0_32px_rgba(128,241,255,0.2)] transition hover:bg-cyan-100"
            href={launch.primaryHref}
          >
            {launch.primaryLabel}
            <ArrowRight className="h-4 w-4" />
          </a>
          <a
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.07] px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.12]"
            href={TELEGRAM_SUPPORT_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            Telegram testers
            <ExternalLink className="h-4 w-4" />
          </a>
          {launch.showFaucet ? (
            <a
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.07] px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.12]"
              href={faucetUrl}
            >
              Base Sepolia faucet
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : (
            <a
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.07] px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.12]"
              href={alphaUrl}
            >
              Testnet alpha
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

export function landingLaunchCtaForLocation(
  location: Pick<Location, "hostname"> | undefined = typeof window === "undefined" ? undefined : window.location,
): LandingLaunchCta {
  const productionHost = location?.hostname === "veydrift.com" || location?.hostname === "www.veydrift.com";

  if (productionHost) {
    return {
      eyebrow: "Mainnet live on Base",
      primaryHref: playUrl,
      primaryLabel: "Play",
      secondaryHref: alphaUrl,
      secondaryLabel: "Testnet alpha",
      supportCopy: "The testnet alpha remains available while migration is prepared; mainnet play uses Base mainnet contracts on veydrift.com.",
      showFaucet: false,
    };
  }

  return {
    eyebrow: "Alpha test live on Base Sepolia",
    primaryHref: alphaUrl,
    primaryLabel: "Join the alpha test",
    secondaryHref: "#how-it-works",
    secondaryLabel: "How it works",
    supportCopy: "The current alpha runs on testnet. When mainnet launches, testnet resources and progress are planned to migrate over, so alpha testers keep what they earn.",
    showFaucet: true,
  };
}

function AlliancesSection() {
  const alliances = useTopAlliances();

  return (
    <section className="relative overflow-hidden bg-[#080b12] px-5 py-24 sm:px-8 sm:py-32 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-16">
        <div>
          <p className="text-sm font-semibold text-ember">Alliances</p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight text-white sm:text-5xl">
            Conquer faster with a war room behind you.
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
            Veydrift is not a solo idle clicker. Alliances coordinate defense, pick targets,
            share pressure across systems and turn resource control into political power.
          </p>
        </div>
        <div className="landing-alliance-board">
          <div className="flex items-center justify-between border-b border-white/[0.04] px-4 py-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-ember" />
              <h3 className="text-sm font-semibold text-white">Top alliances</h3>
            </div>
            <span className="text-xs font-semibold text-slate-500">{landingAllianceBoardLabel(alliances.status)}</span>
          </div>
          <div className="grid gap-2 p-3">
            {alliances.items.length > 0
              ? alliances.items.map((alliance, index) => (
                <div className="landing-alliance-row" key={`${alliance.tag}-${index}`}>
                  <span className="landing-alliance-rank">{index + 1}</span>
                  <div className="min-w-0">
                    <p>{alliance.name}</p>
                    <span>{landingCommanderCount(alliance.members)}</span>
                  </div>
                  <strong>{formatLandingScore(alliance.score)}</strong>
                </div>
              ))
              : <LandingAllianceEmpty status={alliances.status} />}
          </div>
        </div>
      </div>
    </section>
  );
}

function LandingFeedRow({ item }: { item: LandingFeedItem }) {
  return (
    <div className="landing-feed-row" data-tone={item.tone}>
      <Activity className="h-4 w-4" />
      <div>
        <p>{item.label}</p>
        <span>{item.value}</span>
      </div>
    </div>
  );
}

function LandingAllianceEmpty({ status }: { status: LandingLoadStatus }) {
  return (
    <div className="landing-alliance-empty">
      <p>{status === "loading" ? "Syncing indexed alliances" : "No ranked alliances"}</p>
      <span>{landingAllianceEmptyCopy(status)}</span>
    </div>
  );
}

function LandingStatusPill({ status }: { status: LandingLoadStatus }) {
  const ready = status === "ready";
  const offline = status === "offline";
  const empty = status === "empty";
  return (
    <span
      className={`rounded border px-2 py-1 text-xs ${
        ready
          ? "border-emerald-300/[0.1] bg-emerald-300/10 text-emerald-100"
          : offline
            ? "border-amber-300/[0.12] bg-amber-300/10 text-amber-100"
            : "border-cyan-300/[0.12] bg-cyan-300/10 text-cyan-100"
      }`}
    >
      {ready ? "Live" : offline ? "Offline" : empty ? "Quiet" : "Syncing"}
    </span>
  );
}

function useLandingFeed(): { items: LandingFeedItem[]; status: LandingLoadStatus } {
  const [feed, setFeed] = useState<{ items: LandingFeedItem[]; status: LandingLoadStatus }>({
    items: [],
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    let activeController: AbortController | null = null;

    const loadLandingFeed = () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;

      fetchLandingActiveMissions(controller.signal)
        .then((missions) => {
          if (cancelled) return;
          const items = landingFeedFromMissions(missions);
          setFeed({ items, status: items.length > 0 ? "ready" : "empty" });
        })
        .catch((error) => {
          if (cancelled || isAbortError(error)) return;
          setFeed({ items: [], status: "offline" });
        });
    };

    loadLandingFeed();
    const intervalId = window.setInterval(loadLandingFeed, landingFeedRefreshMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      activeController?.abort();
    };
  }, []);

  return feed;
}

function useTopAlliances(): { items: LandingAlliance[]; status: LandingLoadStatus } {
  const [alliances, setAlliances] = useState<{ items: LandingAlliance[]; status: LandingLoadStatus }>({
    items: [],
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    let activeController: AbortController | null = null;

    const loadLandingAlliances = () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;

      fetchLandingHighscores(controller.signal)
        .then((data) => {
          if (cancelled) return;
          const next = topAlliancesFromHighscores(data);
          setAlliances({ items: next, status: next.length > 0 ? "ready" : "empty" });
        })
        .catch((error) => {
          if (cancelled || isAbortError(error)) return;
          setAlliances({ items: [], status: "offline" });
        });
    };

    loadLandingAlliances();
    const intervalId = window.setInterval(loadLandingAlliances, landingAllianceRefreshMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      activeController?.abort();
    };
  }, []);

  return alliances;
}

async function fetchLandingActiveMissions(signal?: AbortSignal): Promise<LandingFleetMission[]> {
  const response = await fetch(`${playableApiUrl}/missions?status=active`, {
    headers: { accept: "application/json" },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error("Failed to load landing missions");
  const data = await response.json() as { missions?: LandingFleetMission[] };
  return data.missions ?? [];
}

async function fetchLandingHighscores(signal?: AbortSignal): Promise<LandingHighscoreEntry[]> {
  const params = new URLSearchParams({
    category: "total",
    page: "1",
    pageSize: "250",
  });
  const response = await fetch(`${playableApiUrl}/highscores?${params.toString()}`, {
    headers: { accept: "application/json" },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error("Failed to load landing highscores");
  const data = await response.json() as { rankings?: { total?: LandingHighscoreEntry[] } };
  return data.rankings?.total ?? [];
}

export function landingFeedFromMissions(missions: readonly LandingFleetMission[], now = Date.now()): LandingFeedItem[] {
  return [...missions]
    .sort((left, right) => landingMissionSortTime(left, now) - landingMissionSortTime(right, now))
    .slice(0, 4)
    .map((mission) => landingFeedItemFromMission(mission, now));
}

function landingFeedItemFromMission(mission: LandingFleetMission, now: number): LandingFeedItem {
  const label = landingMissionTypeLabel(mission.missionType);
  const origin = landingPlanetLabel(mission.originPlanet, mission.originPlanetId);
  const target = landingPlanetLabel(mission.targetPlanet, mission.targetPlanetId);
  const commander = shortLandingWallet(mission.owner);
  const timeCopy = landingMissionTimeCopy(mission, now);

  return {
    label,
    tone: landingMissionTone(mission.missionType),
    value: `${commander}: ${landingMissionMovementCopy(mission.missionType, origin, target)}${timeCopy ? `, ${timeCopy}` : ""}`,
  };
}

function landingMissionMovementCopy(missionType: string, origin: string, target: string): string {
  if (["Attack", "AcsAttack", "MissileAttack"].includes(missionType)) return `strike fleet inbound to ${target}`;
  if (missionType === "Harvest") return `recyclers moving toward ${target}`;
  if (missionType === "Transport") return `transport convoy crossing from ${origin} to ${target}`;
  if (missionType === "Deploy") return `deployment moving from ${origin} to ${target}`;
  if (missionType === "Colonize") return `colony fleet moving from ${origin} to ${target}`;
  if (["AcsDefend", "DefenseHold", "Intercept"].includes(missionType)) return `defense fleet stationing at ${target}`;
  return `${landingMissionTypeLabel(missionType).toLowerCase()} mission moving from ${origin} to ${target}`;
}

function landingMissionTone(missionType: string): LandingFeedTone {
  if (["Attack", "AcsAttack", "MissileAttack"].includes(missionType)) return "rose";
  if (missionType === "Harvest") return "amber";
  if (["Deploy", "Colonize", "AcsDefend", "DefenseHold", "Intercept"].includes(missionType)) return "emerald";
  return "cyan";
}

function landingMissionTypeLabel(missionType: string): string {
  if (missionType === "AcsAttack") return "Group attack";
  if (missionType === "AcsDefend") return "Group defense";
  if (missionType === "DefenseHold") return "Stationed defense";
  return missionType.replace(/([A-Z])/g, " $1").trim() || "Fleet mission";
}

function landingMissionTimeCopy(mission: LandingFleetMission, now: number): string {
  const returning = mission.status === "Returning" || mission.status === "Recalled";
  const timestamp = landingTimestampMs(returning ? mission.returnAt : mission.arrivalAt);
  const countdown = formatLandingCountdown(timestamp, now);
  if (!countdown) return "";
  if (countdown === "now") return returning ? "landing now" : "arriving now";
  return returning ? `lands in ${countdown}` : `arrives in ${countdown}`;
}

function landingMissionSortTime(mission: LandingFleetMission, now: number): number {
  const returning = mission.status === "Returning" || mission.status === "Recalled";
  const timestamp = landingTimestampMs(returning ? mission.returnAt : mission.arrivalAt);
  if (timestamp === undefined) return Number.MAX_SAFE_INTEGER;
  return Math.max(timestamp, now);
}

function landingPlanetLabel(planet: LandingMissionPlanet | null | undefined, fallbackId: string): string {
  if (planet?.name) return planet.name;
  if (planet?.coordinates) return planet.coordinates;
  if (
    Number.isFinite(planet?.galaxy)
    && Number.isFinite(planet?.system)
    && Number.isFinite(planet?.position)
  ) {
    return `${planet!.galaxy}:${planet!.system}:${planet!.position}`;
  }
  return `planet #${fallbackId}`;
}

function landingTimestampMs(value: string): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed > 10_000_000_000 ? parsed : parsed * 1_000;
}

function formatLandingCountdown(timestamp: number | undefined, now: number): string {
  if (timestamp === undefined) return "";
  const seconds = Math.max(0, Math.round((timestamp - now) / 1_000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function shortLandingWallet(wallet: string): string {
  return /^0x[a-fA-F0-9]{40}$/.test(wallet)
    ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}`
    : wallet || "Commander";
}

export function topAlliancesFromHighscores(entries: readonly LandingHighscoreEntry[]): LandingAlliance[] {
  const byId = new Map<string, LandingAlliance & { wallets: Set<string> }>();

  for (const entry of entries) {
    if (!entry.alliance) continue;
    const existing = byId.get(entry.alliance.allianceId);
    const score = safeLandingBigInt(entry.totalUserScore ?? entry.score.total);
    if (!existing) {
      byId.set(entry.alliance.allianceId, {
        members: 0,
        name: entry.alliance.name || entry.alliance.tag || `Alliance #${entry.alliance.allianceId}`,
        score: String(score),
        tag: entry.alliance.tag,
        wallets: new Set(entry.wallet ? [entry.wallet.toLowerCase()] : []),
      });
      continue;
    }

    if (entry.wallet) existing.wallets.add(entry.wallet.toLowerCase());
    existing.score = String(safeLandingBigInt(existing.score) + score);
  }

  return [...byId.values()]
    .map(({ wallets, ...alliance }) => ({
      ...alliance,
      members: Math.max(alliance.members, wallets.size || 1),
    }))
    .sort((left, right) => {
      const leftScore = safeLandingBigInt(left.score);
      const rightScore = safeLandingBigInt(right.score);
      if (leftScore === rightScore) return left.name.localeCompare(right.name);
      return leftScore < rightScore ? 1 : -1;
    })
    .slice(0, 5);
}

function formatLandingScore(score: string): string {
  const value = Number(score);
  if (!Number.isFinite(value) || value <= 0) return "Forming";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function safeLandingBigInt(value: string | undefined): bigint {
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
}

function landingFeedEmptyCopy(status: LandingLoadStatus): string {
  if (status === "loading") return "Reading the backend mission index for current fleet movement.";
  if (status === "offline") return "The alpha API is not reachable from this page right now.";
  return "The backend mission index has no active universe-wide fleet rows right now.";
}

function landingAllianceEmptyCopy(status: LandingLoadStatus): string {
  if (status === "loading") return "Reading the backend highscore index for alliance membership.";
  if (status === "offline") return "The alpha API is not reachable from this page right now.";
  return "The backend highscore index has no alliance-ranked commanders yet.";
}

function landingAllianceBoardLabel(status: LandingLoadStatus): string {
  if (status === "loading") return "Syncing";
  if (status === "offline") return "Offline";
  return "Score";
}

function landingCommanderCount(count: number): string {
  return `${count} commander${count === 1 ? "" : "s"}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
