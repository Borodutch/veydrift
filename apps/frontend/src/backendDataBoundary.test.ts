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
    expect(storeSource).toContain("return this.state.read(key, load");
    expect(storeSource).toContain('priority: "selected-planet"');
  });

  test("keeps canonical data and freshness in one subscribed runtime store", async () => {
    const storeSource = await Bun.file(new URL("./backendDataStore.ts", import.meta.url)).text();
    const planetStoreSource = await Bun.file(new URL("./planetSectionStore.ts", import.meta.url)).text();
    const guide = await Bun.file(new URL("../../../docs/frontend-data-store.md", import.meta.url)).text();
    const playerGuide = await Bun.file(new URL("./docs/content/docs.md", import.meta.url)).text();

    expect(storeSource).toContain("private readonly state = new GameStateStore()");
    expect(storeSource).toContain("subscribe(listener");
    expect(storeSource).toContain("snapshot<T>(key: string)");
    expect(planetStoreSource).toContain("export type PlanetSectionRefreshStatus");
    expect(planetStoreSource).toContain("export function setPlanetSectionData");
    expect(guide).toContain("canonical runtime owner");
    expect(guide).toContain("Deadlines begin at enqueue time");
    expect(playerGuide).toContain("one shared game-state store and priority scheduler");
    expect(playerGuide).toContain("the same stored responses");
  });

  test("migrated surfaces subscribe to canonical snapshots without response shadow state", async () => {
    const appSource = await Bun.file(new URL("./PlayableMvpApp.tsx", import.meta.url)).text();
    const galaxySource = await Bun.file(new URL("./components/GalaxyView.tsx", import.meta.url)).text();
    const planetSource = await Bun.file(new URL("./components/PlanetDetail.tsx", import.meta.url)).text();
    const moonSource = await Bun.file(new URL("./components/PublicMoonDetail.tsx", import.meta.url)).text();

    for (const canonicalProjection of [
      "settlementSnapshot",
      "walletPlanetsSnapshot",
      "queuesSnapshot",
      "fleetVisibilitySnapshot",
      "missionArchiveSnapshot",
      "globalMissionArchiveSnapshot",
      "infrastructureSnapshot",
      "defenseSnapshot",
      "shipyardSnapshot",
      "researchSnapshot",
    ]) {
      expect(appSource).toContain(`const ${canonicalProjection} = useBackendDataSnapshot`);
    }
    expect(appSource).not.toMatch(/useState<(?:WalletSettlementResponse|FleetMissionVisibilityResponse|FleetMissionArchiveResponse|GlobalMissionArchiveResponse)/);
    expect(appSource).not.toMatch(/const \[(?:onChainStatus|onChainError|activePlanetStateFresh|canonicalPlanetResources|planetSectionStore|allianceState|allianceLoading|allianceError),/);
    expect(galaxySource).toContain("useBackendDataSnapshot<ApiSystemResponse>");
    expect(galaxySource).toContain("useBackendDataSnapshots<AttackProtectionStatus>");
    expect(galaxySource).not.toContain("useState<Planet[]>(");
    expect(galaxySource).not.toMatch(/useState<Record<string, AttackProtectionStatus>>/);
    expect(planetSource).toContain("useBackendDataSnapshot<ApiSystemResponse>");
    expect(planetSource).not.toContain("useState<Planet | null>");
    expect(moonSource).toContain("useBackendDataSnapshot<ApiSystemResponse>");
    expect(moonSource).not.toContain("useState<Planet | null>");
  });

  test("scheduled backend transports forward their AbortSignal", async () => {
    const storeSource = await Bun.file(new URL("./backendDataStore.ts", import.meta.url)).text();

    expect(storeSource).not.toMatch(/return this\.refresh\(key, (?:async )?\(\) => fetch(?:Wallet|Fleet|Global|Mission|Battle|System|Highscore)/);
    expect(storeSource).toContain("fetchFleetMissionArchive(this.apiBaseUrl, wallet, { ...fetchOptions, signal })");
    expect(storeSource).toContain("fetchGlobalMissionArchive(this.apiBaseUrl, { ...fetchOptions, signal })");
    expect(storeSource).toContain("fetchMission(this.apiBaseUrl, missionId, signal)");
  });
});
