import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ArrowRight, Check, Coins, ExternalLink, Handshake, Repeat, Rocket, Swords, Users } from "lucide-preact";
import { submitPactInterest } from "../pactInterest";
import { SiteHeader } from "./SiteHeader";
import { TelegramIcon } from "./TelegramIcon";
import { TrailerPlayer } from "./TrailerPlayer";

const telegramUrl = "https://t.me/borodutch";

// Snapshot of https://stats.veydrift.com (the stats API has no CORS, so these are not fetched live).
const tractionAsOf = "Sep 30, 2026";
const traction = [
  { value: "75%", label: "of every player who ever joined played this week", note: "72 of 96 wallets active in the last 7 days" },
  { value: "92%", label: "DAU / WAU", note: "66 daily players out of 72 weekly" },
  { value: "~44", label: "onchain actions per daily player, per day", note: "every build, fleet and raid is a Base transaction" },
  { value: "4 mo", label: "live in open alpha", note: "since May 29, 2026, before any token or launch" },
] as const;
const totals = [
  { value: "353K", label: "transactions" },
  { value: "95.9K", label: "fleet missions" },
  { value: "17.7K", label: "battles" },
  { value: "8", label: "alliances" },
] as const;

const products = [
  { name: "Shieldy", users: "60.5M", note: "A Telegram anti-spam bot that was acquired by 1inch Network." },
  { name: "Randy", users: "24.5M", note: "A bot that runs raffles in Telegram groups." },
  { name: "Banofbot", users: "14.5M", note: "A bot that lets communities moderate by vote." },
  { name: "Voicy", users: "6.3M", note: "A voice recognition bot that has transcribed over 123M messages." },
] as const;

const game = [
  { icon: Rocket, title: "Classic space strategy, fully onchain", body: "You settle planets, grow mines, research, build fleets and defenses, raid rivals and fight in alliances, while contracts on Base enforce every rule." },
  { icon: Coins, title: "Resources are real tokens", body: "Metal, Crystal and Deuterium are 1:1 reserve-backed ERC-20s (vMETAL, vCRYSTAL, vDEUT). Every in-game unit is backed by the game contract's reserve." },
  { icon: Swords, title: "The Rift makes exits a war", body: "Market resources enter the game instantly, but extracting them locks them on a planet for four weeks where everyone can see and raid them, so defense, logistics and raids become economic services." },
  { icon: Repeat, title: "$VEYDRIFT routes the economy", body: "Every resource pool pairs with $VEYDRIFT, and $VEYDRIFT pairs with WETH. Anyone buying or selling game resources goes through it." },
] as const;

const steps = [
  { tag: "Now", title: "The Pact", body: "5% of supply at $0.002 per $VEYDRIFT, $50K–$100K. First in line, before any public price exists." },
  { tag: "Next", title: "Grow the game", body: "Pact money goes into improving Veydrift and marketing to bring in more players. The auction comes after the player base has grown." },
  { tag: "Then", title: "Continuous clearing auction", body: "250M $VEYDRIFT sold through Uniswap's onchain CCA, with a floor 30% above the Pact price. Price discovery happens over time, not in the first block, so snipers don't win by default." },
  { tag: "Finally", title: "Open liquidity", body: "Auction proceeds plus 250M reserved $VEYDRIFT migrate automatically into a Uniswap v4 $VEYDRIFT/WETH pool, alongside three $VEYDRIFT/resource pools. Positions sit in a time lock with no owner and no early-unlock path." },
] as const;

const pactPriceUsd = 0.002;
const pactTokens = 50_000_000;
const totalSupply = 1_000_000_000;
const pactTerms = [
  { label: "Allocation", value: "5% of supply", note: "50,000,000 $VEYDRIFT, carved out of the contributor allocation; unsold tokens stay with contributors" },
  { label: "Price", value: "$0.002", note: "per $VEYDRIFT — a $2M fully diluted valuation" },
  { label: "Round size", value: "$50K–$100K", note: "$50K buys 2.5% of supply, $100K buys the full 5%" },
  { label: "Minimum", value: "$1,000", note: "500,000 $VEYDRIFT" },
  { label: "Auction floor", value: "$0.0026", note: "30% above the Pact price — the public auction can't sell below it" },
  { label: "Vesting", value: "6-month cliff", note: "12.5% unlocks 6 months after the auction ends, the rest vests linearly over the next 3.5 years" },
] as const;

const allocations = [
  { label: "Continuous clearing auction", share: 25, color: "bg-signal", note: "250M — public price discovery" },
  { label: "$VEYDRIFT/WETH liquidity", share: 25, color: "bg-cyan-600", note: "250M — paired with auction proceeds, time-locked" },
  { label: "Resource liquidity", share: 15, color: "bg-ember", note: "150M — 50M each vs vMETAL, vCRYSTAL, vDEUT" },
  { label: "Development", share: 15, color: "bg-violet-400", note: "150M — 5-year linear vesting" },
  { label: "Contributors", share: 5, color: "bg-emerald-400", note: "50M — 4-year vesting, 1-year cliff; unsold Pact tokens return here" },
  { label: "The Pact", share: 5, color: "bg-white", note: "50M — $0.002 each; 6-month cliff after the auction, then 3.5-year vesting" },
  { label: "Ecosystem & strategic", share: 10, color: "bg-rose-400", note: "100M — 6-year linear vesting; unsold auction tokens also go here" },
] as const;

export function PactApp() {
  useEffect(() => {
    document.title = "The Veydrift Pact";
  }, []);

  return (
    <main className="playable-starfield relative isolate min-h-dvh overflow-x-hidden bg-[#060b16] text-white [&>*]:relative [&>*]:z-10">
      <SiteHeader current="pact" />

      {/* Hero copy and trailer share one row so the first screen carries the whole pitch. */}
      <section className="relative px-5 pb-6 pt-10 sm:px-8 sm:pt-14">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center lg:gap-10">
          <div>
            <p className="landing-eyebrow rounded-full border border-cyan-300/20 bg-cyan-400/[0.08] px-3 py-1.5">
              <Handshake className="h-3.5 w-3.5" />
              Friends & family round · 5% of supply at $0.002
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] sm:text-5xl">
              The Veydrift Pact: get $VEYDRIFT before the auction.
            </h1>
            <p className="mt-5 text-base leading-7 text-slate-300">
              Veydrift is an onchain space strategy game on Base. Players have been playing it every day for four months, before there
              was any token to hold. The Pact offers 5% of the supply at $0.002 per token to people who want in before the public auction
              sets a price. Pact money goes into the game and into marketing to bring in more players before the auction.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <a className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-signal px-5 py-2.5 text-sm font-bold text-[#031014] shadow-[0_0_32px_rgba(128,241,255,0.22)] transition hover:bg-cyan-100" href="#join">
                Join the Pact
                <ArrowRight className="h-4 w-4" />
              </a>
              <a className="surface-inset inline-flex min-h-11 items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition hover:text-cyan-100" href="https://veydrift.com" rel="noopener noreferrer" target="_blank">
                Play Veydrift
                <ExternalLink className="h-4 w-4" />
              </a>
              <a className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/[0.06] hover:text-white" href={telegramUrl} rel="noopener noreferrer" target="_blank">
                <TelegramIcon className="h-4 w-4" />
                Message me on Telegram
              </a>
            </div>
          </div>
          <div aria-label="Veydrift trailer" className="scroll-mt-16" role="region" id="trailer" tabIndex={-1}>
            <TrailerPlayer />
          </div>
        </div>
      </section>

      <Section eyebrow="Traction" title="Players who join Veydrift tend to stay.">
        <p className="max-w-3xl text-slate-300">
          Veydrift hasn't done a launch push yet. What it has is a core of players who come back every single day and play
          hard — the hardest part of any game to fake, and the thing a token launch can't buy.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {traction.map((item) => (
            <div className="landing-feature" key={item.label}>
              <div className="text-3xl font-semibold text-signal">{item.value}</div>
              <h3>{item.label}</h3>
              <p>{item.note}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {totals.map((item) => (
            <div className="surface-inset rounded-lg px-4 py-3" key={item.label}>
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
        <p className="max-w-3xl text-slate-300">
          I'm Nikita "Borodutch" Kolmogorov. My products have reached over 106 million users, and I've funded
          all of them myself. Veydrift is open source and built in public.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((item) => (
            <div className="landing-feature" key={item.name}>
              <div className="text-3xl font-semibold text-amber-300">{item.users}</div>
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
        <div className="grid gap-3 md:grid-cols-2">
          {game.map((item) => (
            <article className="landing-feature" key={item.title}>
              <item.icon className="h-5 w-5 text-signal" />
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <a className="inline-flex items-center gap-1.5 text-signal hover:underline" href="#trailer">Watch the trailer</a>
          <ExternalLinkText href="/docs">Read the docs</ExternalLinkText>
        </div>
      </Section>

      <Section eyebrow="Launch path" title="The Pact comes first, then the game grows before the auction opens liquidity.">
        <ol className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <li className={`landing-feature ${index === 0 ? "!border-cyan-300/40 ring-1 ring-cyan-300/20" : ""}`} key={step.title}>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] ${index === 0 ? "bg-signal text-[#031014]" : "surface-inset text-cyan-100"}`}>
                {index + 1} · {step.tag}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section eyebrow="Pact terms" title="The Pact sells 5% of supply at $0.002 per token, and the auction floor sits 30% higher.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pactTerms.map((term) => (
            <div className="landing-feature" key={term.label}>
              <h3 className="!mt-0 !text-[10px] !font-semibold uppercase tracking-[0.14em] !text-cyan-300/70">{term.label}</h3>
              <div className="mt-2 text-3xl font-semibold text-signal">{term.value}</div>
              <p>{term.note}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-slate-400">Allocations are first come, first served until the $100K cap is reached.</p>
      </Section>

      <Section eyebrow="Tokenomics" title="The supply is fixed forever at 1,000,000,000 $VEYDRIFT.">
        <p className="max-w-3xl text-slate-300">
          The token has no owner, no minter, no proxy and no pause switch. The entire supply is allocated once at genesis, and
          team tokens vest for years.
        </p>
        <div className="mt-6 flex h-3 overflow-hidden rounded-full" aria-hidden="true">
          {allocations.map((item) => (
            <div className={item.color} key={item.label} style={{ width: `${item.share}%` }} />
          ))}
        </div>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {allocations.map((item) => (
            <li className="surface-inset flex gap-3 rounded-lg p-4" key={item.label}>
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
      </Section>

      <section className="scroll-mt-16 px-5 py-10 sm:px-8 sm:py-14" id="join">
        <div className="landing-panel mx-auto grid max-w-6xl gap-8 bg-[linear-gradient(135deg,rgba(34,211,238,0.1),rgba(13,24,41,0.96)_55%)] p-6 sm:p-8 lg:grid-cols-[1fr_1fr]">
          <div>
            <p className="landing-eyebrow">Join the Pact</p>
            <h2 className="mt-2 text-2xl font-semibold leading-tight sm:text-[2rem]">Tell me how much $VEYDRIFT you want.</h2>
            <p className="mt-4 text-slate-300">
              $0.002 per $VEYDRIFT, capped at $100K for the full 5%. Allocations go to the people who reach out first. Leave
              your details and I'll follow up personally to confirm your allocation.
            </p>
            <div className="surface-inset mt-8 rounded-xl p-5">
              <p className="flex items-center gap-2 font-semibold">
                <Users className="h-4 w-4 text-signal" />
                Rather talk first?
              </p>
              <p className="mt-2 text-sm text-slate-300">Message me directly and ask anything — the game, the numbers, the terms.</p>
              <a className="mt-4 inline-flex items-center gap-2 rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20" href={telegramUrl} rel="noopener noreferrer" target="_blank">
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
  const [amountUsd, setAmountUsd] = useState(0);
  const tokens = Math.floor(amountUsd / pactPriceUsd);

  const submit = async (event: Event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    setStatus("sending");
    setError("");
    try {
      await submitPactInterest({ amountUsd: form.get("amountUsd"), email: form.get("email"), telegram: form.get("telegram") });
      setStatus("sent");
    } catch (caught) {
      setStatus("idle");
      setError(caught instanceof Error && caught.message ? caught.message : "Something went wrong. Message me on Telegram instead.");
    }
  };

  if (status === "sent") {
    return (
      <div className="surface-inset flex flex-col items-start justify-center rounded-xl p-6">
        <Check className="h-8 w-8 text-signal" />
        <h3 className="mt-4 text-2xl font-semibold">You're on the list.</h3>
        <p className="mt-2 text-slate-300">I'll reach out to confirm your allocation. Want to move faster? Ping me on Telegram.</p>
      </div>
    );
  }

  const input = "mt-1.5 w-full rounded-lg border border-cyan-300/15 bg-[#081120] px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/60 focus:outline-none";
  return (
    <form className="surface-inset grid content-start gap-4 rounded-xl p-6" onSubmit={submit}>
      <label className="text-sm font-semibold text-slate-200">
        How much do you want to put in? (USD, $1,000–$100,000)
        <input className={input} inputMode="numeric" max={100_000} min={1_000} name="amountUsd" onInput={(event) => setAmountUsd(Number(event.currentTarget.value) || 0)} placeholder="5000" required step={100} type="number" />
        {tokens > 0 && tokens <= pactTokens ? (
          <span className="mt-2 block font-normal text-signal">
            = {tokens.toLocaleString("en-US")} $VEYDRIFT · {((tokens / totalSupply) * 100).toLocaleString("en-US", { maximumFractionDigits: 3 })}% of supply
          </span>
        ) : null}
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
      <button className="mt-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-signal px-6 py-3 text-sm font-bold text-[#031014] transition hover:bg-cyan-100 disabled:opacity-60" disabled={status === "sending"} type="submit">
        {status === "sending" ? "Sending…" : "Request my allocation"}
        <ArrowRight className="h-4 w-4" />
      </button>
    </form>
  );
}

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: ComponentChildren }) {
  return (
    <section className="px-5 py-9 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <p className="landing-eyebrow">{eyebrow}</p>
        <h2 className="mb-4 mt-2 max-w-4xl text-2xl font-semibold leading-tight sm:text-[2rem]">{title}</h2>
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
