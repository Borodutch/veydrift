import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ArrowRight, Check, Coins, ExternalLink, Handshake, Lock, Repeat, Rocket, Swords, Users } from "lucide-preact";
import { playableApiUrl } from "../runtimeConfig";
import { TelegramIcon } from "./TelegramIcon";

const telegramUrl = "https://t.me/borodutch";

// Snapshot of https://stats.veydrift.com (the stats API has no CORS, so these are not fetched live).
const tractionAsOf = "Sep 30, 2026";
const traction = [
  { value: "75%", label: "of every player who ever joined played this week", note: "72 of 96 wallets active in the last 7 days" },
  { value: "92%", label: "DAU / WAU", note: "66 daily players out of 72 weekly" },
  { value: "~44", label: "onchain actions per daily player, per day", note: "every build, fleet and raid is a Base transaction" },
  { value: "4 mo", label: "live in open alpha", note: "since May 29, 2026 — pre-token, pre-launch" },
] as const;
const totals = [
  { value: "353K", label: "transactions" },
  { value: "95.9K", label: "fleet missions" },
  { value: "17.7K", label: "battles" },
  { value: "8", label: "alliances" },
] as const;

const products = [
  { name: "Shieldy", users: "60.5M", note: "Telegram anti-spam. Acquired by 1inch Network." },
  { name: "Randy", users: "24.5M", note: "Telegram raffles." },
  { name: "Banofbot", users: "14.5M", note: "Community moderation by vote." },
  { name: "Voicy", users: "6.3M", note: "123M+ voice messages transcribed." },
] as const;

const game = [
  { icon: Rocket, title: "Classic space strategy, fully onchain", body: "Settle planets, grow mines, research, build fleets and defenses, raid rivals, fight in alliances. Contracts on Base enforce every rule." },
  { icon: Coins, title: "Resources are real tokens", body: "Metal, Crystal and Deuterium are 1:1 reserve-backed ERC-20s (vMETAL, vCRYSTAL, vDEUT). Every in-game unit is backed by the game contract's reserve." },
  { icon: Swords, title: "The Rift makes exits a war", body: "Market resources enter the game instantly. Extracting them locks them on a planet for four weeks — visible and raidable. Defense, logistics and raids become economic services." },
  { icon: Repeat, title: "$VEYDRIFT routes the economy", body: "Every resource pool pairs with $VEYDRIFT, and $VEYDRIFT pairs with WETH. Anyone buying or selling game resources goes through it." },
] as const;

const steps = [
  { tag: "Now", title: "The Pact", body: "A $50K–$100K friends & family round. Small, direct, and first in line — before any public price exists." },
  { tag: "Next", title: "Continuous clearing auction", body: "250M $VEYDRIFT sold through Uniswap's onchain CCA. Price discovery happens over time, not in the first block, so snipers don't win by default." },
  { tag: "Then", title: "Open liquidity", body: "Auction proceeds plus 250M reserved $VEYDRIFT migrate automatically into a Uniswap v4 $VEYDRIFT/WETH pool, alongside three $VEYDRIFT/resource pools. Positions sit in a time lock with no owner and no early-unlock path." },
] as const;

const allocations = [
  { label: "Continuous clearing auction", share: 25, color: "bg-signal", note: "250M — public price discovery" },
  { label: "$VEYDRIFT/WETH liquidity", share: 25, color: "bg-cyan-600", note: "250M — paired with auction proceeds, time-locked" },
  { label: "Resource liquidity", share: 15, color: "bg-ember", note: "150M — 50M each vs vMETAL, vCRYSTAL, vDEUT" },
  { label: "Development", share: 15, color: "bg-violet-400", note: "150M — 5-year linear vesting" },
  { label: "Contributors", share: 10, color: "bg-emerald-400", note: "100M — 4-year vesting, 1-year cliff" },
  { label: "Ecosystem & strategic", share: 10, color: "bg-rose-400", note: "100M — 6-year linear vesting" },
] as const;

export function PactApp() {
  useEffect(() => {
    document.title = "The Veydrift Pact";
  }, []);

  return (
    <main className="playable-starfield relative isolate min-h-dvh overflow-x-hidden bg-void text-white [&>*]:relative [&>*]:z-10">
      <header className="relative z-20 border-b border-white/10 bg-void/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3 sm:px-8">
          <a className="text-sm font-semibold text-white hover:text-signal" href="/">Veydrift</a>
          <nav className="flex items-center gap-2 text-xs font-semibold">
            <a className="rounded border border-white/15 bg-white/[0.06] px-3 py-1.5 text-slate-200 hover:bg-white/10" href="/overview">Play</a>
            <a className="inline-flex items-center gap-1.5 rounded border border-signal/30 bg-signal/10 px-3 py-1.5 text-signal hover:bg-signal/20" href={telegramUrl} rel="noopener noreferrer" target="_blank">
              <TelegramIcon className="h-3.5 w-3.5" />
              @borodutch
            </a>
          </nav>
        </div>
      </header>

      <section className="relative px-5 pb-16 pt-16 sm:px-8 sm:pt-24">
        <div className="mx-auto max-w-6xl">
          <p className="inline-flex items-center gap-2 rounded-full bg-signal/[0.08] px-3 py-1.5 text-sm font-semibold text-signal">
            <Handshake className="h-4 w-4" />
            Friends & family round · $50K–$100K
          </p>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-[1.05] sm:text-6xl">
            The Veydrift Pact: get $VEYDRIFT before the auction.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            Veydrift is an onchain space strategy game on Base. Players have been playing it every day for four months, before there
            was any token to hold. The Pact is a small round for people who want in before the public auction sets a price.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a className="inline-flex min-h-12 items-center gap-2 rounded-full bg-signal px-6 py-3 text-sm font-bold text-[#031014] shadow-[0_0_40px_rgba(128,241,255,0.3)] hover:brightness-110" href="#join">
              Join the Pact
              <ArrowRight className="h-4 w-4" />
            </a>
            <a className="inline-flex min-h-12 items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-6 py-3 text-sm font-semibold text-white hover:bg-white/10" href={telegramUrl} rel="noopener noreferrer" target="_blank">
              <TelegramIcon className="h-4 w-4" />
              Message me on Telegram
            </a>
          </div>
        </div>
      </section>

      <Section eyebrow="Traction" title="Players who join, stay.">
        <p className="max-w-2xl text-slate-300">
          Veydrift hasn't done a launch push yet. What it has is a core of players who come back every single day and play
          hard — the hardest part of any game to fake, and the thing a token launch can't buy.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {traction.map((item) => (
            <div className="landing-feature !min-h-0" key={item.label}>
              <div className="text-4xl font-semibold text-signal">{item.value}</div>
              <h3>{item.label}</h3>
              <p>{item.note}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {totals.map((item) => (
            <div className="rounded-lg border border-white/5 bg-white/[0.03] px-4 py-3" key={item.label}>
              <p className="text-xl font-semibold">{item.value}</p>
              <p className="text-sm text-slate-400">{item.label}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-slate-500">
          Snapshot as of {tractionAsOf}. Live numbers:{" "}
          <a className="text-signal hover:underline" href="https://stats.veydrift.com" rel="noopener noreferrer" target="_blank">stats.veydrift.com</a>
        </p>
      </Section>

      <Section eyebrow="Who is building it" title="Built by someone who has shipped to 106M+ users.">
        <p className="max-w-2xl text-slate-300">
          I'm Nikita "Borodutch" Kolmogorov. My products have reached over 106 million users, one was acquired, and I've funded
          all of them myself. Veydrift is open source and built in public.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((item) => (
            <div className="landing-feature !min-h-0" key={item.name}>
              <div className="text-3xl font-semibold text-ember">{item.users}</div>
              <h3>{item.name}</h3>
              <p>{item.note}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <ExternalLinkText href="https://borodutch.com">borodutch.com</ExternalLinkText>
          <ExternalLinkText href="https://github.com/Borodutch/veydrift">Veydrift on GitHub</ExternalLinkText>
        </div>
      </Section>

      <Section eyebrow="The game" title="An economy players fight over.">
        <div className="grid gap-4 md:grid-cols-2">
          {game.map((item) => (
            <article className="landing-feature !min-h-0" key={item.title}>
              <item.icon className="h-5 w-5 text-signal" />
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <ExternalLinkText href="/">Watch the trailer</ExternalLinkText>
          <ExternalLinkText href="/docs">Read the docs</ExternalLinkText>
        </div>
      </Section>

      <Section eyebrow="Launch path" title="Pact → auction → open liquidity.">
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map((step, index) => (
            <li className={`landing-feature !min-h-0 ${index === 0 ? "border-signal/40 ring-1 ring-signal/30" : ""}`} key={step.title}>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${index === 0 ? "bg-signal text-[#031014]" : "bg-white/10 text-slate-300"}`}>
                {index + 1} · {step.tag}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section eyebrow="Tokenomics" title="1,000,000,000 $VEYDRIFT. Fixed forever.">
        <p className="max-w-2xl text-slate-300">
          No owner, no minter, no proxy, no pause switch. The entire supply is allocated once, at genesis, and team tokens vest
          for years.
        </p>
        <div className="mt-8 flex h-4 overflow-hidden rounded-full" aria-hidden="true">
          {allocations.map((item) => (
            <div className={item.color} key={item.label} style={{ width: `${item.share}%` }} />
          ))}
        </div>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {allocations.map((item) => (
            <li className="flex gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-4" key={item.label}>
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${item.color}`} />
              <div>
                <p className="font-semibold">
                  {item.share}% <span className="text-slate-300">{item.label}</span>
                </p>
                <p className="text-sm text-slate-400">{item.note}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-6 flex items-start gap-2 text-sm text-slate-400">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
          Half the supply goes to the public auction and its liquidity. Pact pricing, size and unlock terms are shared one-on-one.
        </p>
      </Section>

      <section className="scroll-mt-16 px-5 py-20 sm:px-8" id="join">
        <div className="mx-auto grid max-w-6xl gap-10 rounded-2xl border border-signal/20 bg-[linear-gradient(135deg,rgba(128,241,255,0.08),rgba(246,179,92,0.05))] p-6 sm:p-10 lg:grid-cols-[1fr_1fr]">
          <div>
            <p className="text-sm font-semibold text-signal">Join the Pact</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">Tell me how much $VEYDRIFT you want.</h2>
            <p className="mt-4 text-slate-300">
              The round is capped at $100K, and allocations go to the people who reach out first. Leave your details and I'll
              send you the terms personally. No commitment until you've seen them.
            </p>
            <div className="mt-8 rounded-xl border border-white/10 bg-void/60 p-5">
              <p className="flex items-center gap-2 font-semibold">
                <Users className="h-4 w-4 text-signal" />
                Rather talk first?
              </p>
              <p className="mt-2 text-sm text-slate-300">Message me directly and ask anything — the game, the numbers, the terms.</p>
              <a className="mt-4 inline-flex items-center gap-2 rounded-full border border-signal/30 bg-signal/10 px-5 py-2.5 text-sm font-semibold text-signal hover:bg-signal/20" href={telegramUrl} rel="noopener noreferrer" target="_blank">
                <TelegramIcon className="h-4 w-4" />
                t.me/borodutch
              </a>
            </div>
          </div>
          <PactForm />
        </div>
      </section>

      <footer className="px-5 pb-12 text-center text-xs leading-5 text-slate-500 sm:px-8">
        <p className="mx-auto max-w-3xl">
          This page is not an offer to sell or a solicitation to buy any token. Details can change before launch. Crypto assets are
          volatile and you can lose everything you put in; only participate with money you can afford to lose.
        </p>
      </footer>
    </main>
  );
}

function PactForm() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const submit = async (event: Event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    setStatus("sending");
    setError("");
    try {
      const response = await fetch(`${playableApiUrl}/pact/interest`, {
        body: JSON.stringify({ amountUsd: form.get("amountUsd"), email: form.get("email"), telegram: form.get("telegram") }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { message?: string } | null)?.message ?? "");
      setStatus("sent");
    } catch (caught) {
      setStatus("idle");
      setError(caught instanceof Error && caught.message ? caught.message : "Something went wrong. Message me on Telegram instead.");
    }
  };

  if (status === "sent") {
    return (
      <div className="flex flex-col items-start justify-center rounded-xl border border-signal/30 bg-void/60 p-6">
        <Check className="h-8 w-8 text-signal" />
        <h3 className="mt-4 text-2xl font-semibold">You're on the list.</h3>
        <p className="mt-2 text-slate-300">I'll reach out with the Pact terms. Want to move faster? Ping me on Telegram.</p>
      </div>
    );
  }

  const input = "mt-1.5 w-full rounded-lg border border-white/15 bg-void/70 px-4 py-3 text-white placeholder:text-slate-500 focus:border-signal focus:outline-none";
  return (
    <form className="grid content-start gap-4 rounded-xl border border-white/10 bg-void/60 p-6" onSubmit={submit}>
      <label className="text-sm font-semibold text-slate-200">
        How much do you want to put in? (USD, min $1,000)
        <input className={input} inputMode="numeric" max={1_000_000} min={1_000} name="amountUsd" placeholder="5000" required step={100} type="number" />
      </label>
      <label className="text-sm font-semibold text-slate-200">
        Email
        <input autoComplete="email" className={input} name="email" placeholder="you@example.com" required type="email" />
      </label>
      <label className="text-sm font-semibold text-slate-200">
        Telegram <span className="font-normal text-slate-500">(optional)</span>
        <input className={input} name="telegram" pattern="@?[A-Za-z0-9_]{3,32}" placeholder="@username" />
      </label>
      {error ? <p className="text-sm text-rose-300" role="alert">{error}</p> : null}
      <button className="mt-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-signal px-6 py-3 text-sm font-bold text-[#031014] hover:brightness-110 disabled:opacity-60" disabled={status === "sending"} type="submit">
        {status === "sending" ? "Sending…" : "Request my allocation"}
        <ArrowRight className="h-4 w-4" />
      </button>
    </form>
  );
}

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: ComponentChildren }) {
  return (
    <section className="px-5 py-16 sm:px-8 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold text-signal">{eyebrow}</p>
        <h2 className="mb-6 mt-3 max-w-3xl text-3xl font-semibold leading-tight sm:text-5xl">{title}</h2>
        {children}
      </div>
    </section>
  );
}

function ExternalLinkText({ href, children }: { href: string; children: ComponentChildren }) {
  const external = href.startsWith("http");
  return (
    <a className="inline-flex items-center gap-1.5 text-signal hover:underline" href={href} {...(external ? { rel: "noopener noreferrer", target: "_blank" } : {})}>
      {children}
      {external ? <ExternalLink className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
    </a>
  );
}
