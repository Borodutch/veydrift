import type { ComponentType } from "preact";
import { lazy, Suspense } from "preact/compat";
import { AuctionBanner } from "./components/AuctionBanner";

// Each page is its own chunk, so the docs and the calculator don't download the game, and the home page
// doesn't download the docs. main.tsx loads the current page's chunk before the first render, so the app
// takes over the copy prerendered for crawlers (scripts/prerender.mjs) in place.
const pages = {
  home: () => import("./FirstPlanetSettlementApp").then((module) => module.FirstPlanetSettlementApp),
  docs: () => import("./components/DocsPage").then((module) => module.DocsApp),
  calculator: () => import("./components/BattleCalculatorPage").then((module) => module.BattleCalculatorApp),
};
type PageKey = keyof typeof pages;
const lazyPages = Object.fromEntries(
  Object.entries(pages).map(([key, load]) => [key, lazy(() => load().then((component) => ({ default: component })))]),
) as Record<PageKey, ComponentType>;

function currentPage(): PageKey {
  const path = typeof window === "undefined" ? "/" : window.location.pathname.replace(/\/+$/, "");
  if (path === "/docs" || path.startsWith("/docs/")) return "docs";
  if (path === "/calculator") return "calculator";
  return "home";
}

let preloaded: { key: PageKey; component: ComponentType } | undefined;

/** Loads the current page's chunk; main.tsx renders after it. */
export function preloadPage(): Promise<void> {
  const key = currentPage();
  return pages[key]().then((component) => { preloaded = { key, component }; });
}

export function App() {
  return (
    <>
      <AuctionBanner />
      <Page />
    </>
  );
}

function Page() {
  const key = currentPage();
  if (preloaded?.key === key) {
    const Loaded = preloaded.component;
    return <Loaded />;
  }
  const Lazy = lazyPages[key];
  return <Suspense fallback={<div className="min-h-dvh bg-[#060b16]" />}><Lazy /></Suspense>;
}
