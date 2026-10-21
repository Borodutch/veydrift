import { lazy, Suspense } from "preact/compat";
import { AuctionBanner } from "./components/AuctionBanner";
import { DocsApp } from "./components/DocsPage";
import { FirstPlanetSettlementApp } from "./FirstPlanetSettlementApp";

const BattleCalculatorApp = lazy(() => import("./components/BattleCalculatorPage").then((module) => ({ default: module.BattleCalculatorApp })));

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
  if (typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === "/calculator") {
    return <Suspense fallback={<div className="min-h-dvh bg-[#060b16]" />}><BattleCalculatorApp /></Suspense>;
  }

  return <FirstPlanetSettlementApp />;
}
