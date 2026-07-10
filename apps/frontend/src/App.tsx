import { ComingSoonApp } from "./ComingSoonApp";
import { DocsApp } from "./components/DocsPage";
import { FirstPlanetSettlementApp } from "./FirstPlanetSettlementApp";

export function App() {
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/docs")) {
    return <DocsApp />;
  }

  if (typeof window !== "undefined" && window.location.pathname.startsWith("/play")) {
    return <FirstPlanetSettlementApp />;
  }

  const surface = import.meta.env.MODE === "settlement" || import.meta.env.MODE === "playable"
    ? import.meta.env.MODE
    : import.meta.env.VITE_VEYDRIFT_SURFACE;

  if (surface === "playable") {
    return <FirstPlanetSettlementApp />;
  }

  if (surface === "settlement" || surface === "test") {
    return <FirstPlanetSettlementApp />;
  }

  return <ComingSoonApp />;
}
