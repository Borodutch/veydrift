// Presentation-only fixture: real Overview, no wallet or API access.
import { render } from "preact";
import { OverviewPage } from "../../src/components/OverviewPage";
import { createInitialPlayableState } from "../../src/playableMvp";
import "../../src/styles.css";

const now = 1_790_279_000_000;
const state = createInitialPlayableState(now);
const root = document.getElementById("app")!;
const resources = { metal: 0, crystal: 0, deuterium: 0 };
const queue = (kind: string, itemId = 0) => ({
  active: true, kind, itemId, quantity: 3,
  cost: { metal: "4000", crystal: "0", deuterium: "0" },
  startedAt: String(now / 1000 - 60), readyAt: String(now / 1000 + 600),
});
let navigated = "";
function show(mode = "empty", count = 1) {
  const production = { ...queue("defense"), backlog: Array.from({ length: count }, (_, i) => queue("defense", i % 8)) };
  const unsettled = { ...queue("defense", 7), asOfNow: { complete: true, secondsRemaining: 0, remainingQuantity: 0 },
    backlog: Array.from({ length: count }, (_, i) => ({ ...queue("defense", i % 8), asOfNow: { complete: true, secondsRemaining: 0, remainingQuantity: 0 } })) };
  render(<main style={{ margin: "12px auto", padding: "0 12px", maxWidth: "1440px" }}>
    <OverviewPage state={state} settledState={state} now={now} rates={resources} caps={resources}
      queueProgress={0.1} researchProgress={0.1} shipProgress={0.1}
      isWalletConnected={false} onChainStatus="local"
      onNavigate={page => { navigated = page; }}
      onChainQueues={mode === "empty" ? undefined : {
        wallet: "0x0000000000000000000000000000000000000001", homePlanetId: "1",
        building: null, research: null, ship: null, defense: production, unsettledDefense: unsettled,
        ...(mode === "active" ? { building: { ...queue("building"), targetLevel: 12 }, research: { ...queue("research"), targetLevel: 3 }, ship: { ...queue("ship"), backlog: production.backlog.map(entry => ({ ...entry, kind: "ship" })) } } : {}),
      }}
      buildingActionNotice={mode === "active" ? { buildingKey: "metalMine", tone: "error", label: "Construction blocked. Reconnect your wallet and refresh the planet before trying again." } : undefined}
      researchAction={mode === "active" ? { status: "error", label: "Research request rejected. Reconnect your wallet and try again when the connection is restored." } : { status: "idle" }}
    />
  </main>, root);
}
Object.assign(window, { fixture: { show, navigated: () => navigated } });
show();
document.body.style.background = "#05070d";
