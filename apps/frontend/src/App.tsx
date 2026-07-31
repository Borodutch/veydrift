import { DocsApp } from "./components/DocsPage";
import { FirstPlanetSettlementApp } from "./FirstPlanetSettlementApp";

export function App() {
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/docs")) {
    return <DocsApp />;
  }

  return <FirstPlanetSettlementApp />;
}
