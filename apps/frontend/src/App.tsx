import { DocsApp } from "./components/DocsPage";
import { PactApp } from "./components/PactPage";
import { FirstPlanetSettlementApp } from "./FirstPlanetSettlementApp";

export function App() {
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/docs")) {
    return <DocsApp />;
  }
  if (typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === "/pact") {
    return <PactApp />;
  }

  return <FirstPlanetSettlementApp />;
}
