import { ComingSoonApp } from "./ComingSoonApp";
import { FirstPlanetSettlementApp } from "./FirstPlanetSettlementApp";
import { PlayableMvpApp } from "./PlayableMvpApp";

export function App() {
  const surface = import.meta.env.VITE_VEYDRIFT_SURFACE;

  if (surface === "playable") {
    return <PlayableMvpApp />;
  }

  if (surface === "settlement" || surface === "test") {
    return <FirstPlanetSettlementApp />;
  }

  return <ComingSoonApp />;
}
