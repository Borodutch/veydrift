import type { ComponentType } from "preact";
import { lazy, Suspense } from "preact/compat";
import { AuctionBanner } from "./components/AuctionBanner";
import { DocsApp } from "./components/DocsPage";
import { FirstPlanetSettlementApp } from "./FirstPlanetSettlementApp";

const BattleCalculatorApp = lazy(() => import("./components/BattleCalculatorPage").then((module) => ({ default: module.BattleCalculatorApp })));
const isCalculatorPage = () => typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === "/calculator";
let preloadedCalculator: ComponentType | undefined;

/** Loads the battle calculator's chunk when it's the current page; main.tsx renders after it. */
export function preloadPage(): Promise<void> {
  if (!isCalculatorPage()) return Promise.resolve();
  return import("./components/BattleCalculatorPage").then((module) => { preloadedCalculator = module.BattleCalculatorApp; });
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
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/docs")) {
    return <DocsApp />;
  }
  if (isCalculatorPage()) {
    const Calculator = preloadedCalculator;
    return Calculator ? <Calculator /> : <Suspense fallback={<div className="min-h-dvh bg-[#060b16]" />}><BattleCalculatorApp /></Suspense>;
  }

  return <FirstPlanetSettlementApp />;
}
