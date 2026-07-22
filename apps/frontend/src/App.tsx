import { DocsApp } from "./components/DocsPage";
import { FirstPlanetSettlementApp } from "./FirstPlanetSettlementApp";

export function App() {
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/docs")) {
    return <DocsApp />;
  }

  if (typeof window !== "undefined" && window.location.pathname.startsWith("/play")) {
    return <FirstPlanetSettlementApp />;
  }

  return <FirstPlanetSettlementApp />;
}
