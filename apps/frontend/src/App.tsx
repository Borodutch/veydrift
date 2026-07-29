import { DocsApp } from "./components/DocsPage";
import { CcaLaunchBanner } from "./components/CcaLaunchBanner";
import { CcaApp } from "./CcaApp";
import { FirstPlanetSettlementApp } from "./FirstPlanetSettlementApp";

export function App() {
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/cca")) {
    return <CcaApp />;
  }

  if (typeof window !== "undefined" && window.location.pathname.startsWith("/docs")) {
    return <DocsApp />;
  }

  return (
    <>
      <CcaLaunchBanner />
      <FirstPlanetSettlementApp />
    </>
  );
}
