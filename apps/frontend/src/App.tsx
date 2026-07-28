import { DocsApp } from "./components/DocsPage";
import { CcaApp } from "./CcaApp";
import { FirstPlanetSettlementApp } from "./FirstPlanetSettlementApp";

function CcaStickyBanner() {
  return (
    <aside className="cca-launch-banner" aria-label="$VEYDRIFT auction">
      <a href="/cca">
        <span><b>$VEYDRIFT</b> auction is live on Base</span>
        <span>Place a bid <span aria-hidden="true">→</span></span>
      </a>
    </aside>
  );
}

export function App() {
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/cca")) {
    return <CcaApp />;
  }

  if (typeof window !== "undefined" && window.location.pathname.startsWith("/docs")) {
    return <DocsApp />;
  }

  return (
    <>
      <CcaStickyBanner />
      <FirstPlanetSettlementApp />
    </>
  );
}
