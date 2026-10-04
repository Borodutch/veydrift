import { AttackReadinessError } from "../../src/playerNotice";
import { preparePublicTargetBattleForecast, AttackOutcomePanel } from "../../src/components/MissionCreationPage";
import { emptyMissionShips } from "../../src/galaxyActions";
import { render } from "preact";
import { DefensePage } from "../../src/components/DefensePage";
import { OverviewPage } from "../../src/components/OverviewPage";
import { renderMissionControlPage } from "../../src/components/MissionControlPage";
import { MissionDetailPage } from "../../src/components/MissionDetailPage";
import { renderMissionBattleForecastPanel } from "../../src/components/MissionBattleForecastPanel";
import { ActivityRow } from "../../src/components/PlayerActivityDialog";
import { createInitialPlayableState } from "../../src/playableMvp";
import type { ChainDefenseState, FleetMissionSummary, MissionDetailResponse, PlayerActivityItem } from "../../src/walletFlow";
import "../../src/styles.css";
const now = 1790279000000;
const noop = () => {};
const resources = { metal: "99999999", crystal: "99999999", deuterium: "99999999" };
const cost = { metal: "2000", crystal: "0", deuterium: "0" };
const canonicalQueue = { active: true, kind: "defense", itemId: 0, quantity: 23, readyAt: String(now / 1000), cost, asOfNow: { complete: true, secondsRemaining: 0, remainingQuantity: 0 } };
const defense: ChainDefenseState = { wallet: "0xabc", homePlanetId: "7", resources, resourcesAsOfNow: resources, shipyardLevel: 12, naniteLevel: 2, missileSiloLevel: 2, technologyLevels: {}, defenses: [{ id: 0, count: 101, cost }], queue: null, unsettledQueue: canonicalQueue };
const mission: FleetMissionSummary = { missionId: "42", owner: "0xabc", status: "Outbound", missionType: "Attack", originPlanetId: "7", targetPlanetId: "9", arrivalAt: String(now / 1000 - 600), returnAt: String(now / 1000 + 600), fuelCost: "25", recallCost: null, attackGroupId: null, joinedAttackMissionIds: [], cargo: { metal: "0", crystal: "0", deuterium: "0" }, ships: { lightFighter: "10" }, transactionHash: "0xabc", blockNumber: "1", needsResolution: true, resolutionEligible: true, asOfNow: { arrived: true, returned: false, secondsUntilArrival: 0, secondsUntilReturn: 600 } };
const activity: PlayerActivityItem = { id: "production:1", wallet: "0xabc", category: "production", kind: "defense-completed", direction: "personal", title: "Rocket Launcher completed", detail: "23 built", occurredAt: String(now / 1000 - 600), transactionAt: String(now / 1000), transactionHash: null, relatedTransactionHash: null, blockNumber: null, logIndex: null, reconciliation: "projected", metadata: {} };
function show(surface = "defense", mode = "current") {
 const fleet: FleetMissionSummary = { ...mission, ...(mode === "randomness" ? { resolutionBlocker: "randomness_pending", resolutionEligible: false, needsResolution: false } : mode === "queued" ? { resolutionEligible: false, needsResolution: false } : mode === "staged" ? { combatResolutionProgress: { roundsCompleted: 3, totalRounds: 6 } } : {}) };
 const detail = { mission: fleet, battleReport: null } as MissionDetailResponse;
 const visibility = { wallet: "0xabc", homePlanetId: "7", incoming: [], outgoing: [fleet], returning: [], joinableAttacks: [], completedMissions: [], battleReports: [] };
 let page;
 if (mode === "report-pending" || mode === "report-failed") detail.battleReportMaterialization = { status: mode === "report-pending" ? "pending" : "failed" } as MissionDetailResponse["battleReportMaterialization"];
 if (mode === "partial") { defense.defenses[0]!.count = 81; defense.queue = { ...canonicalQueue, quantity: 20, asOfNow: { complete: false, secondsRemaining: 200, remainingQuantity: 20 } }; }
 else { defense.defenses[0]!.count = 101; defense.queue = null; }
 if (surface === "defense") page = <DefensePage actionState={{ status: "idle" }} canTransact defenseState={mode === "loading" || mode === "empty" ? null : defense} loading={mode === "loading"} error={mode === "error" ? "Service unavailable" : undefined} onBuild={noop} onRefresh={noop} now={now} />;
 if (surface === "overview") { const state = createInitialPlayableState(now); const r = { metal: 0, crystal: 0, deuterium: 0 }; page = <OverviewPage state={state} settledState={state} now={now} rates={r} caps={r} queueProgress={0} researchProgress={0} shipProgress={0} isWalletConnected={false} onChainStatus="local" onNavigate={noop} onChainQueues={{ wallet: "0xabc", homePlanetId: "7", building: null, research: null, ship: null, defense: null, unsettledDefense: canonicalQueue }} />; }
 if (surface === "control") page = renderMissionControlPage({ actionState: { status: "idle" }, canTransact: true, loading: mode === "loading", now, fleetVisibility: mode === "loading" ? undefined : mode === "empty" ? { ...visibility, outgoing: [] } : visibility, initialView: { activeTab: "mine", activePage: 0, pastTab: "mine", pastPage: 0 }, onCounterplay: noop, onJoinAttack: noop, onRecall: noop, onRefresh: noop, onOpenReport: noop, onOpenReportList: noop });
 if (surface === "detail") page = <MissionDetailPage actionState={{ status: "idle" }} canTransact detail={mode === "loading" || mode === "empty" ? undefined : detail} error={mode === "error" ? "Mission unavailable. Try again shortly." : undefined} loading={mode === "loading"} missionId="42" now={now} fleetVisibility={visibility} onBack={noop} onShareReport={noop} onCounterplay={noop} onRecall={noop} onRetry={noop} onSelectCoordinates={noop} onSelectPlayer={noop} />;
 if (surface === "forecast") { detail.mission = { ...mission, arrivalAt: String(now / 1000 + 600) }; if (mode !== "missing") detail.battleForecast = { leaderMissionId: "42", asOf: String(now / 1000 - (mode === "stale" ? 60 : 0)), arrivalAt: String(now / 1000 + (mode === "arrived" ? -1 : 600)), targetIsMoon: false, participants: [], stationedDefenders: [], target: null, unavailableReason: "INTERNAL raw indexing storage-order diagnostic" }; page = renderMissionBattleForecastPanel({ detail, now }, false); }
 if (surface === "readiness") page = <p role="alert">{new AttackReadinessError().message}</p>;
 if (surface === "composer") { const prepared = preparePublicTargetBattleForecast(emptyMissionShips(), undefined, undefined, false, { participants: [], stationedDefenders: [], selectedAttackerLaneGroup: null, unavailableReason: "INTERNAL unknown indexing roster diagnostic" }); page = prepared.status === "complete" ? <AttackOutcomePanel battleForecast={prepared.forecast} /> : null; }
 if (surface === "activity") page = <ActivityRow explorerUrl="https://basescan.org" item={{ ...activity, ...(mode === "indexed" ? { reconciliation: "indexed", transactionHash: "0xabc" } : {}) }} />;
 render(<main data-fixture-ready style={{ maxWidth: "1060px", margin: "16px auto", padding: "0 12px" }}>{page}</main>, document.getElementById("app")!);
}
Object.assign(window, { fixture: { show } });
show();
