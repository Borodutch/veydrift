import { expect, test } from "bun:test";
import { currentResources, RESOURCES_UNAVAILABLE } from "../src/currentResources";
import { batchSupplySourceForPlanet, infrastructureUnavailableReasonFor, missionOriginResources, walletCurrentResourcesForActiveBody, walletCurrentResourcesFor } from "../src/PlayableMvpApp";
import { playerNotice } from "../src/playerNotice";
import { researchActionStatus } from "../src/components/ResearchPage";
import { moonDefenseProductionItems, moonShipProductionItems, moonStructureStatus } from "../src/components/MoonPage";
import { productionPlanContext } from "../src/productionBuildPlanContext";
import { createInitialPlayableState } from "../src/playableMvp";
import type { ChainInfrastructureState, ChainResearchState, ChainMoonState, ChainShipyardState } from "../src/walletFlow";
const raw = { metal: "999999", crystal: "999999", deuterium: "999999" };
const zero = { metal: "0", crystal: "0", deuterium: "0" };
test("resource selection preserves unknown, zero, positive and legacy omission across body switches", () => {
 for (const value of [raw, null, zero, undefined, null, raw]) expect(currentResources({ resources: raw, resourcesAsOfNow: value })).toEqual(value === undefined ? raw : value);
 expect(walletCurrentResourcesFor({ infrastructureResourcesAsOfNow: null, infrastructureResources: raw, settlementResources: raw })).toBeUndefined();
 for (const activeBodyKind of ["moon", "planet"] as const) expect(walletCurrentResourcesForActiveBody({ activeBodyKind, moonResourcesAsOfNow: null, moonResources: raw, infrastructureResourcesAsOfNow: null, infrastructureResources: raw, planetResources: raw })).toBeUndefined();
 expect(missionOriginResources({ isWalletConnected: true, planetResources: null, spendableResources: { metal: 99, crystal: 99, deuterium: 99 } })).toBeUndefined();
});
test("machine notices do not leak and wallet/network/auth recovery remains intact", () => {
 for (const message of ["Moon indexed state is not available from this backend yet. Refresh shortly.", "infrastructure loaded from DB-indexed contract state.", "RPC eth_call failed"]) expect(playerNotice(message)).toBe("Game information is temporarily unavailable. Please try again shortly.");
 for (const message of ["User rejected the request.", "Network unavailable. Please try again.", "Sign in again to continue.", "Unauthorized", "No moon exists for this home planet yet."]) expect(playerNotice(message)).toBe(message);
});


test("unknown current resources disable infrastructure/research despite a stale spendable balance", () => {
 const spendable = { metal: 999999, crystal: 999999, deuterium: 999999 };
 const infrastructure = { resources: raw, resourcesAsOfNow: null } as ChainInfrastructureState;
 expect(infrastructureUnavailableReasonFor({ buildingAction: { status: "idle" }, gameContract: "0xabc", homePlanetId: "7", infrastructureChainState: infrastructure, infrastructureLoading: false, isWalletConnected: true, onChainResources: spendable, onChainStatus: "ready", runtimeConfigStatus: "ready" })).toBe(RESOURCES_UNAVAILABLE);
 const state = createInitialPlayableState(); state.buildings.researchLab = 12;
 const research = { homePlanetId: "7", resources: raw, resourcesAsOfNow: null, queue: null } as ChainResearchState;
 expect(researchActionStatus({ actionPending: false, canTransact: true, chainCost: { metal: 0, crystal: 800, deuterium: 400 }, error: undefined, key: "energy", loading: false, now: Date.now(), researchState: research, spendableResources: spendable, state })).toMatchObject({ disabled: true, reason: RESOURCES_UNAVAILABLE });
 expect(productionPlanContext("planet", { infrastructure, defense: null, shipyard: null, moon: null })).toMatchObject({ available: false, resources: null });
});

test("Supply cannot recover an unknown fresh source from an older rich roster", () => {
 const planet = { planetId: "7", name: "Origin", coordinates: "1:1:1", galaxy: 1, system: 1, position: 1, resources: raw, resourcesAsOfNow: raw };
 const shipyard = { resources: raw, resourcesAsOfNow: null, ships: [{ id: 0, count: 10 }], technologyLevels: {} } as ChainShipyardState;
 expect(batchSupplySourceForPlanet(planet, shipyard)).toMatchObject({ resources: { metal: 0, crystal: 0, deuterium: 0 }, unavailableReason: RESOURCES_UNAVAILABLE });
 expect(batchSupplySourceForPlanet(planet, { ...shipyard, resourcesAsOfNow: undefined }).unavailableReason).toBeUndefined();
});

test("moon construction, production and batch plans never spend raw resources after explicit null", () => {
 const moon = { wallet: "0xabc", homePlanetId: "7", resources: raw, resourcesAsOfNow: null, moon: { exists: true, planetId: "7", fields: 30 }, technologyLevels: { "3": 2 }, buildings: [{ id: 0, key: "lunarBase", label: "Lunar Base", level: 1, cost: raw }, { id: 3, key: "shipyard", label: "Shipyard", level: 12, cost: raw }], ships: [{ id: 0, count: 1, cost: raw }], defenses: [{ id: 0, count: 1, cost: raw }], queue: null, defenseQueue: null, shipQueue: null } as unknown as ChainMoonState;
 expect(moonStructureStatus(moon.buildings[0]!, moon.moon!, moon, { canTransact: true })).toMatchObject({ disabled: true, reason: RESOURCES_UNAVAILABLE });
 for (const rows of [moonShipProductionItems({ moonState: moon, quantities: {}, canTransact: true }), moonDefenseProductionItems({ moonState: moon, quantities: {}, canTransact: true, actionPending: false })]) {
  expect(rows[0]).toMatchObject({ disabled: true, blockedReason: RESOURCES_UNAVAILABLE });
 }
 expect(productionPlanContext("moon", { infrastructure: null, defense: null, shipyard: null, moon })).toMatchObject({ available: false, resources: null });
});
