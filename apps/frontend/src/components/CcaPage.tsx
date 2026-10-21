import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ArrowRight, Bot, Check, Coins, ExternalLink, Gavel, Lock, Repeat, Rocket, Scale, Swords, Timer, Undo2, Users } from "lucide-preact";
import { submitCcaInterest } from "../ccaInterest";
import { SiteHeader } from "./SiteHeader";
import { TelegramIcon } from "./TelegramIcon";
import { TrailerPlayer } from "./TrailerPlayer";

const telegramUrl = "https://t.me/borodutch";
const uniswapCcaUrl = "https://cca.uniswap.org/";

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
  { icon: Repeat, title: "$VEYDRIFT routes the economy", body: "Every resource pool pairs with $VEYDRIFT, and $VEYDRIFT pairs with ETH. Anyone buying or selling game resources goes through it." },
] as const;

const mechanics = [
  { icon: Gavel, title: "You bid a budget and a maximum price", body: "A bid says how much ETH you want to spend and the highest price per $VEYDRIFT you are willing to pay. You can bid at any point while the auction runs." },
  { icon: Timer, title: "Tokens are sold block by block for two weeks", body: "The 100M $VEYDRIFT are released over 604,800 Base blocks instead of all at once, with the largest share, about 30%, in the final block. Your budget is spread across the blocks left in the auction, so bidding earlier lets you buy in more of them." },
  { icon: Scale, title: "Everyone in a block pays the same price", body: "Each block clears at a single price: the highest price at which bids cover that block's supply. A bid with a higher maximum fills at the clearing price, never at its own maximum." },
  { icon: Undo2, title: "If you are outbid, you get your ETH back", body: "When the clearing price rises above your maximum, your bid stops buying and the unspent part is refunded. You never pay more than the maximum you set." },
  { icon: Bot, title: "Snipers don't win by default", body: "Because the price is discovered over two weeks at one price per block, there is no first-block rush for bots to win and no reason to race a launch transaction." },
  { icon: Lock, title: "It needs real demand to graduate", body: "The auction only completes if it raises at least $50K in ETH. If it falls short, no pool is created and every bidder can withdraw their ETH in full." },
] as const;

const auctionStart = "October 22 at 1 PM Pacific";

const steps = [
  { tag: "Now", title: "Register interest", body: `Leave your email below and you'll hear from me before the auction opens on ${auctionStart}.` },
  { tag: "Oct 22 – Nov 5", title: "Continuous clearing auction", body: "100M $VEYDRIFT, 10% of the supply, are sold over two weeks on Base through Uniswap's CCA, with a $0.0005 floor and a $50K minimum raise. You bid from the Uniswap web app." },
  { tag: "Nov 5", title: "Liquidity on Uniswap v4", body: "100% of the ETH the auction raises goes into a Uniswap v4 $VEYDRIFT/ETH pool together with 100M reserved $VEYDRIFT, at the final clearing price. The pool position is locked for a year, and none of the raise goes to the team." },
  { tag: "Then", title: "Resource pools", body: "$VEYDRIFT pools against vMETAL, vCRYSTAL and vDEUT open next, so every game resource trades through $VEYDRIFT." },
] as const;

const auctionTerms = [
  { label: "For sale", value: "100M", note: "$VEYDRIFT, 10% of the total supply, sold for ETH on Base; never more, however much is bid" },
  { label: "Starts", value: "Oct 22", note: "1 PM Pacific (20:00 UTC), and runs until November 5 at 12 PM Pacific" },
  { label: "Duration", value: "2 weeks", note: "604,800 Base blocks at two seconds each" },
  { label: "Floor price", value: "$0.0005", note: "per $VEYDRIFT, a $500K fully diluted valuation; no token sells below it" },
  { label: "Minimum raise", value: "$50K", note: "in ETH; if the auction raises less, it doesn't complete and every bidder is refunded" },
  { label: "To liquidity", value: "100%", note: "of the ETH raised goes into the $VEYDRIFT/ETH pool on Uniswap v4, locked for a year" },
] as const;

const allocations = [
  { label: "Continuous clearing auction", share: 10, color: "bg-signal", note: "100M — public price discovery over two weeks" },
  { label: "$VEYDRIFT/ETH liquidity", share: 10, color: "bg-cyan-600", note: "100M — paired with 100% of the auction proceeds" },
  { label: "Resource liquidity", share: 15, color: "bg-ember", note: "150M — 50M each against vMETAL, vCRYSTAL and vDEUT" },
  { label: "Development", share: 25, color: "bg-violet-400", note: "250M — 5-year linear vesting" },
  { label: "Contributors", share: 20, color: "bg-emerald-400", note: "200M — 4-year vesting with a 1-year cliff" },
  { label: "Ecosystem", share: 20, color: "bg-rose-400", note: "200M — 6-year linear vesting" },
] as const;

export function CcaApp() {
  useEffect(() => {
    document.title = "$VEYDRIFT continuous clearing auction";
  }, []);

  return (
    <main className="playable-starfield relative isolate min-h-dvh overflow-x-hidden bg-[#060b16] text-white [&>*]:relative [&>*]:z-10">
      <SiteHeader current="cca" />

      {/* Hero copy and trailer share one row so the first screen carries the whole pitch. */}
      <section className="relative px-5 pb-6 pt-10 sm:px-8 sm:pt-14">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center lg:gap-10">
          <div>
            <p className="landing-eyebrow rounded-full border border-cyan-300/20 bg-cyan-400/[0.08] px-3 py-1.5">
              <Gavel className="h-3.5 w-3.5" />
              Uniswap continuous clearing auction · Oct 22, 1 PM PT
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] sm:text-5xl">
              $VEYDRIFT launches through a fair, onchain auction.
            </h1>
            <p className="mt-5 text-base leading-7 text-slate-300">
              Veydrift is an onchain space strategy game on Base. Players have been playing it every day for four months, before there
              was any token to hold. 10% of the $VEYDRIFT supply will be sold through Uniswap's continuous clearing auction, where
              the price is discovered over two weeks and everyone who buys in the same block pays the same price. It opens on {auctionStart},
              and every dollar it raises goes into liquidity.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <a className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-signal px-5 py-2.5 text-sm font-bold text-[#031014] shadow-[0_0_32px_rgba(128,241,255,0.22)] transition hover:bg-cyan-100" href="#interest">
                Register interest
                <ArrowRight className="h-4 w-4" />
              </a>
              <a className="surface-inset inline-flex min-h-11 items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition hover:text-cyan-100" href="https://veydrift.com" rel="noopener noreferrer" target="_blank">
                Play Veydrift
                <ExternalLink className="h-4 w-4" />
              </a>
              <a className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/[0.06] hover:text-white" href={uniswapCcaUrl} rel="noopener noreferrer" target="_blank">
                About Uniswap CCA
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

      <Section eyebrow="How the auction works" title="A continuous clearing auction discovers the price over time instead of in the first block.">
        <p className="max-w-3xl text-slate-300">
          Most token launches set a price in a single moment, and whoever gets the first transaction in wins. Uniswap's
          continuous clearing auction spreads the sale over two weeks and clears every block at one fair price, so what you pay
          depends on demand rather than on how fast your bot is.
        </p>
        <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {mechanics.map((item) => (
            <article className="landing-feature" key={item.title}>
              <item.icon className="h-5 w-5 text-signal" />
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <ExternalLinkText href={uniswapCcaUrl}>Uniswap's CCA page</ExternalLinkText>
          <ExternalLinkText href="https://github.com/Uniswap/continuous-clearing-auction">CCA source and audits</ExternalLinkText>
        </div>
      </Section>

      <Section eyebrow="Auction terms" title="100M $VEYDRIFT go up for auction on October 22 with a floor of $0.0005 per token.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {auctionTerms.map((term) => (
            <div className="landing-feature" key={term.label}>
              <h3 className="!mt-0 !text-[10px] !font-semibold uppercase tracking-[0.14em] !text-cyan-300/70">{term.label}</h3>
              <div className="mt-2 text-3xl font-semibold text-signal">{term.value}</div>
              <p>{term.note}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 max-w-3xl text-sm text-slate-400">
          If all 100M tokens sell at the floor, the auction raises $50K, its minimum. More demand raises the price, not the amount
          sold: at most 100M are sold, and there is no cap on the raise. Either way, all of it goes into liquidity. Dollar figures
          assume today's ETH price; the floor and the minimum are fixed in ETH when the auction is created.
        </p>
      </Section>

      <Section eyebrow="Launch path" title="The auction opens on October 22, and every dollar it raises becomes liquidity.">
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

      <Section eyebrow="Tokenomics" title="The supply is fixed forever at 1,000,000,000 $VEYDRIFT.">
        <p className="max-w-3xl text-slate-300">
          The token has no owner, no minter, no proxy, no tax and no pause switch. The entire supply was allocated once at genesis:
          35% goes to the auction and to liquidity, and the other 65% vests over four to six years. The contract is{" "}
          <a className="font-mono text-signal hover:underline" href="https://basescan.org/token/0x442E9Ba64899d6B0bD25DF2558d3E804427bF448" rel="noopener noreferrer" target="_blank">0x442E9Ba64899d6B0bD25DF2558d3E804427bF448</a>
          , and the{" "}
          <a className="text-signal hover:underline" href="/docs/contracts">docs</a> list every holder and vesting wallet.
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

      <section className="scroll-mt-16 px-5 py-10 sm:px-8 sm:py-14" id="interest">
        <div className="landing-panel mx-auto grid max-w-6xl gap-8 bg-[linear-gradient(135deg,rgba(34,211,238,0.1),rgba(13,24,41,0.96)_55%)] p-6 sm:p-8 lg:grid-cols-[1fr_1fr]">
          <div>
            <p className="landing-eyebrow">Register interest</p>
            <h2 className="mt-2 text-2xl font-semibold leading-tight sm:text-[2rem]">Get an email before the auction opens on October 22.</h2>
            <p className="mt-4 text-slate-300">
              Leave your email and I'll remind you before bidding opens, with a link straight to the auction. If you already have a rough idea of how much you'd
              bid, add it too; it isn't a commitment, and it helps me size the launch.
            </p>
            <div className="surface-inset mt-6 rounded-xl p-5">
              <p className="flex items-center gap-2 font-semibold">
                <Users className="h-4 w-4 text-signal" />
                Rather talk first?
              </p>
              <p className="mt-2 text-sm text-slate-300">Message me directly and ask anything — the game, the auction, the numbers.</p>
              <a className="mt-4 inline-flex items-center gap-2 rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20" href={telegramUrl} rel="noopener noreferrer" target="_blank">
                <TelegramIcon className="h-4 w-4" />
                t.me/borodutch
              </a>
            </div>
          </div>
          <InterestForm />
        </div>
      </section>

      <footer className="px-5 pb-12 text-center text-xs leading-5 text-slate-500 sm:px-8">
        <p className="mx-auto max-w-3xl">
          This page is not an offer to sell or a solicitation to buy any token. Registering interest is not a commitment, and details
          can change before launch. Crypto assets are volatile and you can lose everything you put in; only participate with money you
          can afford to lose.
        </p>
      </footer>
    </main>
  );
}

function InterestForm() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const submit = async (event: Event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    setStatus("sending");
    setError("");
    try {
      await submitCcaInterest({ amountUsd: form.get("amountUsd"), email: form.get("email"), telegram: form.get("telegram") });
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
        <p className="mt-2 text-slate-300">I'll email you before the auction opens. Questions in the meantime? Ping me on Telegram.</p>
      </div>
    );
  }

  const input = "mt-1.5 w-full rounded-lg border border-cyan-300/15 bg-[#081120] px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/60 focus:outline-none";
  return (
    <form className="surface-inset grid content-start gap-4 rounded-xl p-6" onSubmit={submit}>
      <label className="text-sm font-semibold text-slate-200">
        Email
        <input autoComplete="email" className={input} name="email" placeholder="you@example.com" required type="email" />
      </label>
      <label className="text-sm font-semibold text-slate-200">
        How much might you bid? <span className="font-normal text-slate-500">(USD, optional)</span>
        <input className={input} inputMode="numeric" max={10_000_000} min={0} name="amountUsd" defaultValue={1000} step={1} type="number" />
      </label>
      <label className="text-sm font-semibold text-slate-200">
        Telegram <span className="font-normal text-slate-500">(optional)</span>
        <input className={input} name="telegram" pattern="@?[A-Za-z0-9_]{3,32}" placeholder="@username" />
      </label>
      {error ? <p className="text-sm text-rose-300" role="alert">{error}</p> : null}
      <button className="mt-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-signal px-6 py-3 text-sm font-bold text-[#031014] transition hover:bg-cyan-100 disabled:opacity-60" disabled={status === "sending"} type="submit">
        {status === "sending" ? "Sending…" : "Notify me"}
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
