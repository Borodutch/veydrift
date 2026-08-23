import { describe, expect, test } from "bun:test";

const frontendRoot = new URL("..", import.meta.url).pathname;

describe("frontend backend-data boundary", () => {
  test("keeps raw HTTP reads out of UI components", async () => {
    const violations: string[] = [];
    const files = new Bun.Glob("src/**/*.tsx").scan({ cwd: frontendRoot });

    for await (const file of files) {
      const source = await Bun.file(`${frontendRoot}/${file}`).text();
      if (/\bfetch\s*\(/.test(source)) violations.push(file);
    }

    expect(violations).toEqual([]);
  });

  test("routes shared planet reads through the canonical scheduled store", async () => {
    const appSource = await Bun.file(new URL("./PlayableMvpApp.tsx", import.meta.url)).text();
    const storeSource = await Bun.file(new URL("./backendDataStore.ts", import.meta.url)).text();

    expect(appSource).toContain("backendDataStoreFor(apiBaseUrl)");
    expect(appSource).toContain("backendData!.infrastructure(account, activePlanetId)");
    expect(appSource).toContain("backendData!.queues(account, activePlanetId)");
    expect(storeSource).toContain("private readonly state = new GameStateStore()");
    expect(storeSource).toContain("return this.readRegisteredResource(resource");
    expect(storeSource).toContain('priority: "selected-planet"');
  });

  test("keeps canonical data and freshness in one subscribed runtime store", async () => {
    const storeSource = await Bun.file(new URL("./backendDataStore.ts", import.meta.url)).text();
    const appSource = await Bun.file(new URL("./PlayableMvpApp.tsx", import.meta.url)).text();
    const guide = await Bun.file(new URL("../../../docs/frontend-data-store.md", import.meta.url)).text();
    const playerGuide = await Bun.file(new URL("./docs/content/docs.md", import.meta.url)).text();

    expect(storeSource).toContain("private readonly state = new GameStateStore()");
    expect(storeSource).toContain("private readonly resources = new Map<string, RegisteredResource>()");
    expect(storeSource).toContain("connectChainEvents(");
    expect(storeSource).toContain("startPolling(");
    expect(storeSource).toContain("invalidate(tags");
    expect(storeSource).toContain("subscribe(listener");
    expect(storeSource).toContain("snapshot<T>(key: string)");
    expect(appSource).not.toContain('from "./planetSectionStore"');
    expect(appSource).not.toContain("setPlanetSectionStore");
    expect(guide).toContain("canonical runtime owner");
    expect(guide).toContain("Deadlines begin at enqueue time");
    expect(playerGuide).toContain("one shared game-state store and priority scheduler");
    expect(playerGuide).toContain("the same stored responses");
  });

  test("keeps the write gate, write lifecycle, and defense reconciliation in the canonical store", async () => {
    const appSource = await Bun.file(new URL("./PlayableMvpApp.tsx", import.meta.url)).text();
    const storeSource = await Bun.file(new URL("./backendDataStore.ts", import.meta.url)).text();

    expect(storeSource).toContain("private readonly transactionGates = new Map<string, TransactionActionGate>()");
    expect(storeSource).toContain("private transactionGateFor(walletScope: string)");
    expect(storeSource).toContain("async runWriteTransaction(");
    expect(storeSource).toContain("waitForIndexedResource<T extends");
    expect(storeSource).toContain("waitForStartedDefenseProduction(");
    expect(appSource).toContain("backendData?.writeTransactionKey(undefined, account)");
    expect(appSource).toContain("backendData.runWriteTransaction({");
    expect(appSource).toContain("backendData!.indexing.startedDefenseProduction(");
    expect(appSource).toContain("backendData!.indexing.startedShipProduction(");
    expect(appSource).toContain("backendData!.indexing.startedResearch(");
    expect(appSource).not.toContain("useRef(createTransactionActionGate())");
    expect(appSource).not.toMatch(/useState<WriteTransactionState>/);
    expect(appSource).not.toContain("waitForStartedDefenseProductionState(");
    expect(appSource).not.toContain("waitForIndexedResourceState(");
  });

  test("keeps lazy reconciliation and raw cache primitives out of UI code", async () => {
    const appSource = await Bun.file(new URL("./PlayableMvpApp.tsx", import.meta.url)).text();
    const storeSource = await Bun.file(new URL("./backendDataStore.ts", import.meta.url)).text();
    const frontendFiles = new Bun.Glob("src/**/*.{ts,tsx}").scan({
      cwd: frontendRoot,
    });
    const violations: string[] = [];

    for await (const file of frontendFiles) {
      if (file.endsWith(".test.ts") || file === "src/backendDataStore.ts" || file === "src/gameStateStore.ts") continue;
      const source = await Bun.file(`${frontendRoot}/${file}`).text();
      if (/\.(?:publish|fail|clear)\(/.test(source)) violations.push(file);
      if (/\/index\/(?:rebuild|verify)/.test(source)) violations.push(file);
    }

    expect(appSource).toContain("backendData.waitForIndexedResource(load, expectation)");
    expect(appSource).not.toMatch(/\.(?:commitBackendSnapshot|markBackendFailure|discardBackendSnapshot)\(/);
    expect(appSource).not.toMatch(/backendData\.(?:setProfile|setWalletPlanets|setQueues|setShipyard|setResearch|setAlliance)\(/);
    expect(appSource).not.toContain("waitForIndexed:");
    expect(storeSource).toContain("export type BackendIndexingPlan");
    expect(storeSource).toContain("private readonly indexingPlanRunners");
    expect(violations).toEqual([]);
  });

  test("migrated surfaces subscribe to canonical snapshots without response shadow state", async () => {
    const appSource = await Bun.file(new URL("./PlayableMvpApp.tsx", import.meta.url)).text();
    const galaxySource = await Bun.file(new URL("./components/GalaxyView.tsx", import.meta.url)).text();
    const planetSource = await Bun.file(new URL("./components/PlanetDetail.tsx", import.meta.url)).text();
    const moonSource = await Bun.file(new URL("./components/PublicMoonDetail.tsx", import.meta.url)).text();

    for (const canonicalProjection of [
      "WalletSettlementResponse",
      "WalletPlanetsResponse",
      "PlayerQueuesResponse",
      "FleetMissionVisibilityResponse",
      "FleetMissionArchiveResponse",
      "GlobalMissionArchiveResponse",
      "ChainInfrastructureState",
      "ChainDefenseState",
      "ChainShipyardState",
      "ChainResearchState",
    ]) {
      expect(appSource).toContain(`useBackendDataSnapshot<${canonicalProjection}>`);
    }
    expect(appSource).not.toMatch(/useState<(?:WalletSettlementResponse|FleetMissionVisibilityResponse|FleetMissionArchiveResponse|GlobalMissionArchiveResponse)/);
    expect(appSource).not.toMatch(/useState<PlayerProfile/);
    expect(appSource).toContain("const playerProfileSnapshot = useBackendDataSnapshot<PlayerProfile>");
    expect(appSource).not.toMatch(/const \[(?:onChainStatus|onChainError|activePlanetStateFresh|canonicalPlanetResources|planetSectionStore|allianceState|allianceLoading|allianceError),/);
    expect(galaxySource).toContain("useBackendDataQuery<ApiSystemResponse>");
    expect(galaxySource).toContain("useBackendDataSnapshots<AttackProtectionStatus>");
    expect(galaxySource).not.toContain("useState<Planet[]>(");
    expect(galaxySource).not.toMatch(/useState<Record<string, AttackProtectionStatus>>/);
    expect(planetSource).toContain("useBackendDataQuery<ApiSystemResponse>");
    expect(planetSource).not.toContain("useState<Planet | null>");
    expect(moonSource).toContain("useBackendDataQuery<ApiSystemResponse>");
    expect(moonSource).not.toContain("useState<Planet | null>");
  });

  test("keeps player inspection and alliance roster inspection on store descriptors", async () => {
    const inspectSource = await Bun.file(new URL("./components/InspectPages.tsx", import.meta.url)).text();
    const allianceSource = await Bun.file(new URL("./components/AlliancePage.tsx", import.meta.url)).text();
    const querySource = await Bun.file(new URL("./useBackendDataQuery.ts", import.meta.url)).text();
    const storeSource = await Bun.file(new URL("./backendDataStore.ts", import.meta.url)).text();

    expect(inspectSource).toContain("backendData?.queries.planets(wallet)");
    expect(inspectSource).toContain("useBackendDataQuery");
    expect(inspectSource).not.toContain("Promise.allSettled");
    expect(allianceSource).toContain("playerBackendData.queries.planets(selectedPlayer)");
    expect(allianceSource).toContain("playerBackendData.queries.playerHighscore(selectedPlayer)");
    expect(allianceSource).not.toContain("Promise.allSettled");
    expect(querySource).toContain("BackendDataQueryDescriptor<T>");
    expect(querySource).not.toContain("load: (() => Promise<T>)");
    expect(storeSource).toContain("readonly queries = {");
  });

  test("keeps settlement and referral reads on canonical store queries", async () => {
    const settlementSource = await Bun.file(new URL("./FirstPlanetSettlementApp.tsx", import.meta.url)).text();
    const storeSource = await Bun.file(new URL("./backendDataStore.ts", import.meta.url)).text();

    expect(settlementSource).toContain("useBackendDataQuery(");
    expect(settlementSource).toContain("referralData.queries.referralDashboard(account)");
    expect(settlementSource).toContain("historyData.queries.referralHistory(wallet, historyPage, 25)");
    expect(settlementSource).toContain("referralData.queries.referralCodeInspection(account, referralClaimCode)");
    expect(settlementSource).not.toContain("setTimeout(() => {\n      void inspectReferralCode");
    expect(settlementSource).not.toContain("setTimeout(loadRuntimeConfig");
    expect(settlementSource).not.toContain("createTransactionActionGate");
    expect(settlementSource).toContain("data.runWriteTransaction({");
    expect(settlementSource).toContain("data.indexing.settledPlanet(");
    expect(settlementSource).toContain("data.indexing.referralClaim(");
    expect(storeSource).toContain("referralCodeInspection(");
    expect(storeSource).toContain("paidAllianceInviteResolution(");
    expect(storeSource).toContain("settledPlanet: (");
    expect(storeSource).toContain("referralClaim: (");
  });

  test("scheduled backend transports forward their AbortSignal", async () => {
    const storeSource = await Bun.file(new URL("./backendDataStore.ts", import.meta.url)).text();

    expect(storeSource).not.toMatch(/return this\.refresh\(key, (?:async )?\(\) => fetch(?:Wallet|Fleet|Global|Mission|Battle|System|Highscore)/);
    expect(storeSource).toMatch(/fetchFleetMissionArchive\(this\.apiBaseUrl, wallet, \{\s*\.\.\.options,\s*signal,?\s*\}\)/);
    expect(storeSource).toMatch(/fetchGlobalMissionArchive\(this\.apiBaseUrl, \{\s*\.\.\.options,\s*signal,?\s*\}\)/);
    expect(storeSource).toContain("fetchMission(this.apiBaseUrl, missionId, signal)");
  });

  test("keeps cache and scheduling out of wallet transport adapters", async () => {
    const walletFlowSource = await Bun.file(new URL("./walletFlow.ts", import.meta.url)).text();
    const storeSource = await Bun.file(new URL("./backendDataStore.ts", import.meta.url)).text();

    expect(walletFlowSource).not.toContain("gameApiRecentReads");
    expect(walletFlowSource).not.toContain("gameApiInflightReads");
    expect(walletFlowSource).not.toContain("gameApiReadQueue");
    expect(storeSource).toContain("private readonly state = new GameStateStore()");
    expect(storeSource).toContain("isFresh(key");
  });

  test("simulates every EVM write through the single wallet submission gateway", async () => {
    const walletFlowSource = await Bun.file(new URL("./walletFlow.ts", import.meta.url)).text();
    const sendOccurrences = walletFlowSource.match(/method:\s*["']eth_sendTransaction["']/g) ?? [];

    expect(sendOccurrences).toHaveLength(1);
    expect(walletFlowSource).toMatch(/method:\s*["']eth_call["'][\s\S]{0,1200}method:\s*["']eth_sendTransaction["']/);
    expect(walletFlowSource).toContain("Transaction simulation failed:");
  });

  test("keeps post-write convergence as opaque store plans", async () => {
    const appSource = await Bun.file(new URL("./PlayableMvpApp.tsx", import.meta.url)).text();
    const storeSource = await Bun.file(new URL("./backendDataStore.ts", import.meta.url)).text();

    expect(appSource).not.toContain("afterReceipt?:");
    expect(appSource).not.toContain("waitForIndexed:");
    expect(appSource).toContain("indexing.paidAllianceInvite(account, provider, secret)");
    expect(appSource).toContain("resourceChanges: refreshedPlan.orders.map");
    expect(storeSource).toContain("all: (plans: readonly BackendIndexingPlan[])");
    expect(storeSource).toContain("paidAllianceInvite:");
    expect(storeSource).toContain("startedResearch: (");
  });

  test("uses resource-owned queries instead of page cancellation scopes", async () => {
    const files = ["./components/RankingsPage.tsx", "./components/RaidTargetFinderPage.tsx", "./components/GalaxyView.tsx", "./components/PlanetDetail.tsx", "./components/PublicMoonDetail.tsx"];

    for (const file of files) {
      const source = await Bun.file(new URL(file, import.meta.url)).text();
      expect(source).toContain("useBackendDataQuery");
      expect(source).not.toContain("cancelScope(");
      expect(source).not.toContain("requestScope:");
    }
  });
});
