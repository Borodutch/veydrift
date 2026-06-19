import { useEffect, useState } from "preact/hooks";
import {
  Activity,
  ArrowRight,
  Coins,
  ExternalLink,
  Factory,
  Orbit,
  Radio,
  Rocket,
  Users,
} from "lucide-preact";
import heroUrl from "./assets/veydrift-hero.webp";
import { TELEGRAM_SUPPORT_URL } from "./supportLinks";
import { playableApiUrl } from "./runtimeConfig";

const alphaUrl = "https://test.veydrift.com";
const faucetUrl = "https://docs.base.org/base-chain/network-information/network-faucets";

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

const feedItems = [
  { label: "Shipyard", value: "A Small Cargo line is leaving the docks on New Zion", tone: "cyan" },
  { label: "Battle", value: "Raiders returned with loot while the defender burns", tone: "rose" },
  { label: "Galaxy", value: "Fresh debris lit up near 8:42 and scouts are moving", tone: "amber" },
  { label: "Rift", value: "Resource flows are opening between the universe and open markets", tone: "emerald" },
] as const;

const fallbackAlliances = [
  { tag: "Shalex", name: "Shalex", members: 58, score: "16838" },
  { tag: "SETO", name: "SETO", members: 39, score: "14424" },
  { tag: "CERBERUS", name: "Cerberus", members: 1, score: "3710" },
  { tag: "FROZEN FLAME", name: "FROZEN FLAME", members: 6, score: "2947" },
  { tag: "NEST", name: "TheNEST", members: 4, score: "1836" },
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
  return (
    <section className="landing-hero relative min-h-[92svh] overflow-hidden">
      <img
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        src={heroUrl}
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,7,13,0.35)_0%,rgba(5,7,13,0.76)_78%,#05070d_100%),linear-gradient(90deg,rgba(5,7,13,0.95)_0%,rgba(5,7,13,0.52)_54%,rgba(5,7,13,0.82)_100%)]" />

      <div className="relative z-10 mx-auto flex min-h-[92svh] w-full max-w-7xl flex-col justify-end px-5 pb-14 pt-24 sm:px-8 lg:px-10">
        <div className="max-w-4xl pb-[7svh]">
          <p className="mb-4 text-sm font-semibold text-signal">Alpha test live on Base Sepolia</p>
          <h1 className="max-w-4xl text-5xl font-semibold leading-none text-white sm:text-7xl lg:text-8xl">
            Veydrift
          </h1>
          <p className="mt-6 max-w-3xl text-xl leading-8 text-slate-100 sm:text-2xl sm:leading-9">
            Take command in a vast onchain universe. Build the economy, marshal fleets,
            coordinate with alliance members and turn the Rift into a weapon of conquest.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-signal/30 bg-signal px-5 py-3 text-sm font-semibold text-[#031014] shadow-[0_0_32px_rgba(128,241,255,0.22)] transition hover:bg-cyan-100"
              href={alphaUrl}
            >
              Join the alpha test
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/[0.055] bg-white/8 px-5 py-3 text-sm font-semibold text-slate-100 backdrop-blur transition hover:bg-white/[0.12]"
              href="#how-it-works"
            >
              How it works
              <Orbit className="h-4 w-4" />
            </a>
          </div>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-300">
            The current alpha runs on testnet. When mainnet launches, testnet resources and progress
            are planned to migrate over, so alpha testers keep what they earn.
          </p>
        </div>
      </div>
    </section>
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
            <span className="rounded border border-emerald-300/[0.1] bg-emerald-300/10 px-2 py-1 text-xs text-emerald-100">
              Live
            </span>
          </div>
          <div className="grid gap-2 p-3">
            {feedItems.map((item) => (
              <div className="landing-feed-row" data-tone={item.tone} key={item.value}>
                <Activity className="h-4 w-4" />
                <div>
                  <p>{item.label}</p>
                  <span>{item.value}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AlphaSection() {
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
            href={alphaUrl}
          >
            Join the alpha test
            <ArrowRight className="h-4 w-4" />
          </a>
          <a
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.07] px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.12]"
            href={TELEGRAM_SUPPORT_URL}
          >
            Telegram testers
            <ExternalLink className="h-4 w-4" />
          </a>
          <a
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.07] px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.12]"
            href={faucetUrl}
          >
            Base Sepolia faucet
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
    </section>
  );
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
            <span className="text-xs font-semibold text-slate-500">Total score</span>
          </div>
          <div className="grid gap-2 p-3">
            {alliances.map((alliance, index) => (
              <div className="landing-alliance-row" key={`${alliance.tag}-${index}`}>
                <span className="landing-alliance-rank">{index + 1}</span>
                <div className="min-w-0">
                  <p>{alliance.name}</p>
                  <span>{alliance.members} commanders</span>
                </div>
                <strong>{formatLandingScore(alliance.score)}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function useTopAlliances(): LandingAlliance[] {
  const [alliances, setAlliances] = useState<LandingAlliance[]>(() => [...fallbackAlliances]);

  useEffect(() => {
    let cancelled = false;

    fetchLandingHighscores()
      .then((data) => {
        if (cancelled) return;
        const next = topAlliancesFromHighscores(data);
        if (next.length > 0) setAlliances(next);
      })
      .catch(() => {
        // The landing page should stay usable if the alpha API is down or blocked locally.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return alliances;
}

async function fetchLandingHighscores(): Promise<LandingHighscoreEntry[]> {
  const params = new URLSearchParams({
    category: "total",
    page: "1",
    pageSize: "250",
  });
  const response = await fetch(`${playableApiUrl}/highscores?${params.toString()}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("Failed to load landing highscores");
  const data = await response.json() as { rankings?: { total?: LandingHighscoreEntry[] } };
  return data.rankings?.total ?? [];
}

function topAlliancesFromHighscores(entries: LandingHighscoreEntry[]): LandingAlliance[] {
  const byId = new Map<string, LandingAlliance>();

  for (const entry of entries) {
    if (!entry.alliance) continue;
    const existing = byId.get(entry.alliance.allianceId);
    const score = BigInt(entry.score.total);
    if (!existing) {
      byId.set(entry.alliance.allianceId, {
        members: 1,
        name: entry.alliance.name,
        score: String(score),
        tag: entry.alliance.tag,
      });
      continue;
    }

    existing.members += 1;
    existing.score = String(BigInt(existing.score) + score);
  }

  return [...byId.values()]
    .sort((left, right) => {
      const leftScore = BigInt(left.score);
      const rightScore = BigInt(right.score);
      if (leftScore === rightScore) return 0;
      return leftScore < rightScore ? 1 : -1;
    })
    .slice(0, 5);
}

function formatLandingScore(score: string): string {
  const value = Number(score);
  if (!Number.isFinite(value) || value <= 0) return "Forming";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
