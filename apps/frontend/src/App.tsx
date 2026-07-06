import { ComingSoonApp } from "./ComingSoonApp";
import { DocsApp } from "./components/DocsPage";
import { FirstPlanetSettlementApp } from "./FirstPlanetSettlementApp";
import { PlayableMvpApp } from "./PlayableMvpApp";

export function App() {
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/docs")) {
    return <DocsApp />;
  }

  if (typeof window !== "undefined" && window.location.pathname.startsWith("/play")) {
    return <PlayableMvpApp />;
  }

  const surface = import.meta.env.MODE === "settlement" || import.meta.env.MODE === "playable"
    ? import.meta.env.MODE
    : import.meta.env.VITE_VEYDRIFT_SURFACE;

  if (surface === "playable") {
    return <PlayableMvpApp />;
  }

  if (surface === "settlement" || surface === "test") {
    return <FirstPlanetSettlementApp />;
  }

  return <ComingSoonApp />;
}
