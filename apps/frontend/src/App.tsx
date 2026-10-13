import { lazy, Suspense } from "preact/compat";
import { DocsApp } from "./components/DocsPage";
import { PactApp } from "./components/PactPage";
import { FirstPlanetSettlementApp } from "./FirstPlanetSettlementApp";

const BattleCalculatorApp = lazy(() => import("./components/BattleCalculatorPage").then((module) => ({ default: module.BattleCalculatorApp })));

export function App() {
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/docs")) {
    return <DocsApp />;
  }
  if (typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === "/calculator") {
    return <Suspense fallback={<div className="min-h-dvh bg-[#060b16]" />}><BattleCalculatorApp /></Suspense>;
  }
  if (typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === "/pact") {
    return <PactApp />;
  }

  return <FirstPlanetSettlementApp />;
}
