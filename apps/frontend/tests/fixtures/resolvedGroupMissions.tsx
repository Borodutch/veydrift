import { render } from "preact";
import { renderMissionControlPage } from "../../src/components/MissionControlPage";
import type { BattleReport, FleetMissionSummary } from "../../src/walletFlow";
import captured from "./resolvedGroupMissions.json";
import "../../src/styles.css";

// Public indexed captures; incoming perspective is a fixture, not the forwarded screenshot owner.
const missions = captured.missions as FleetMissionSummary[];
const report = captured.report as BattleReport;
const page = renderMissionControlPage({
  actionState: { status: "idle" }, canTransact: false, loading: false, now: 1790713500000,
  initialView: { activeTab: "mine", activePage: 0, pastTab: "incomingAttacks", pastPage: 0 },
  fleetVisibility: { wallet: missions[0]!.targetPlanet!.owner!, homePlanetId: "812", incoming: [], outgoing: [], returning: [], joinableAttacks: [], completedMissions: missions, battleReports: [report] },
  incomingAttackArchive: { wallet: missions[0]!.targetPlanet!.owner!, homePlanetId: "812", rows: missions.map(mission => ({ kind: "mission", mission, report })), pagination: { page: 1, pageSize: 25, totalEntries: 4, totalPages: 1, hasNextPage: false, hasPreviousPage: false } },
  onCounterplay() {}, onJoinAttack() {}, onRecall() {}, onRefresh() {}, onResolve() {}, onOpenReportList() {},
  onOpenReport(id) { document.querySelector("output")!.textContent = id; },
});
render(<main style={{ maxWidth: "1056px", margin: "16px auto", padding: "0 12px" }}>{page}<output aria-label="Opened mission" /></main>, document.getElementById("app")!);
document.body.style.background = "#05070d";
