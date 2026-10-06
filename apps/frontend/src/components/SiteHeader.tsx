import { ArrowRight, ExternalLink, GitFork } from "lucide-preact";
import { TELEGRAM_SUPPORT_URL } from "../supportLinks";
import { TelegramIcon } from "./TelegramIcon";

type SiteSection = "home" | "pact" | "docs";

const links: Array<{ key: SiteSection | "stats"; label: string; href: string; external?: boolean }> = [
  { key: "docs", label: "Docs", href: "/docs" },
  { key: "pact", label: "Pact", href: "/pact" },
  { key: "stats", label: "Stats", href: "https://stats.veydrift.com", external: true },
];

/** Shared header for the public pages: landing (over the hero art), Pact and Docs (sticky bar). */
export function SiteHeader({ current, overlay = false, wide = false }: { current?: SiteSection | undefined; overlay?: boolean; wide?: boolean }) {
  return (
    <header
      className={overlay
        ? "absolute inset-x-0 top-0 z-30"
        : "sticky top-0 z-30 border-b border-cyan-300/10 bg-[#091120]/85 backdrop-blur"}
    >
      <div className={`mx-auto flex h-14 items-center gap-2 px-4 sm:gap-3 sm:px-6 ${wide ? "max-w-[96rem]" : "max-w-6xl"}`}>
        <a aria-label="Veydrift home" className="group flex shrink-0 items-center gap-2.5" href="/">
          <span className="relative grid h-8 w-8 place-items-center overflow-hidden rounded-full ring-1 ring-cyan-300/40 transition group-hover:ring-cyan-200/80">
            <img alt="" className="h-full w-full scale-125 object-cover" src="/assets/game/style-pass/generated/planets/crystal-violet.webp" />
          </span>
          <span className="text-sm font-semibold uppercase tracking-[0.32em] text-white">Veydrift</span>
        </a>
        <nav aria-label="Site" className="ml-4 hidden items-center gap-0.5 text-sm md:flex">
          {links.map((link) => link.key === current ? (
            <span aria-current="page" className="rounded-md bg-cyan-400/10 px-3 py-1.5 font-medium text-cyan-100" key={link.key}>{link.label}</span>
          ) : (
            <a
              className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 font-medium text-slate-300 transition hover:bg-white/[0.06] hover:text-white"
              href={link.href}
              key={link.key}
              {...(link.external ? { rel: "noopener noreferrer", target: "_blank" } : {})}
            >
              {link.label}
              {link.external ? <ExternalLink aria-hidden="true" className="h-3 w-3 opacity-60" /> : null}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <a
            aria-label="Telegram support"
            className="grid h-9 w-9 place-items-center rounded-md text-signal transition hover:bg-white/[0.06]"
            href={TELEGRAM_SUPPORT_URL}
            rel="noopener noreferrer"
            target="_blank"
            title="Telegram support"
          >
            <TelegramIcon className="h-4 w-4" />
          </a>
          <a
            aria-label="Veydrift on GitHub"
            className="hidden h-9 w-9 place-items-center rounded-md text-slate-300 transition hover:bg-white/[0.06] hover:text-white sm:grid"
            href="https://github.com/Borodutch/veydrift"
            rel="noopener noreferrer"
            target="_blank"
            title="Veydrift on GitHub"
          >
            <GitFork aria-hidden="true" className="h-4 w-4" />
          </a>
          <a
            className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-lg bg-signal px-3.5 text-sm font-bold text-[#031014] shadow-[0_0_24px_rgba(128,241,255,0.2)] transition hover:bg-cyan-100"
            href={current === "home" ? "#claim" : "/"}
          >
            Play
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </a>
        </div>
      </div>
    </header>
  );
}
