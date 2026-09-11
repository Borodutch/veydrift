import { describe, expect, test } from "bun:test";

describe("VEY-KANEO-836 Mission Control wallet scope", () => {
  test("keeps active and past mission state outside the selected-planet cache", async () => {
    const appSource = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();
    const stateStart = appSource.indexOf("// Mission Control is a commander-level surface.");
    const stateEnd = appSource.indexOf("const { snapshot: publicBattleReportsSnapshot,", stateStart);
    const missionState = appSource.slice(stateStart, stateEnd);

    expect(stateStart).toBeGreaterThan(-1);
    expect(missionState).toContain("const { snapshot: fleetVisibilitySnapshot } = useBackendDataQuery");
    expect(missionState).toContain("const { snapshot: missionArchiveSnapshot, isInitialLoading: missionArchiveLoading } = useBackendDataQuery");
    expect(missionState).toContain("const { snapshot: allActiveMissionsSnapshot, isInitialLoading: allActiveMissionsLoading } = useBackendDataQuery");
    expect(missionState).toContain("const { snapshot: globalMissionArchiveSnapshot, isInitialLoading: globalMissionArchiveLoading } = useBackendDataQuery");
    expect(stateEnd).toBeGreaterThan(stateStart);
    // Archetypes are now derived from canonical system snapshots instead of
    // a Mission Control-local response cache.
    expect(appSource).toContain("const missionUniverseSnapshots = useBackendDataSnapshots<ApiSystemResponse>");
    expect(appSource).toContain("const missionPlanetArchetypesByCoordinate = useMemo");
    expect(appSource).not.toContain("setMissionPlanetArchetypesByCoordinate");
    expect(missionState).not.toContain("activePlanetSection");
    expect(missionState).not.toContain("activePlanetId");
    expect(missionState).not.toContain("setPlanetSection");
  });

  test("stores commander-level mission feeds as wallet-wide canonical resources", async () => {
    const storeSource = await Bun.file(new URL("../src/backendDataStore.ts", import.meta.url)).text();

    for (const walletWideKey of [
      "fleetVisibility(",
      "fleetArchive(",
      "globalActiveMissions(",
      "globalMissionArchive(",
    ]) {
      expect(storeSource).toContain(walletWideKey);
    }
    expect(storeSource).toContain('`wallet:${wallet.toLowerCase()}`');
  });

  test("refreshes wallet-wide results directly while preserving only explicit planet filters", async () => {
    const appSource = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();
    const archiveLoader = appSource.slice(
      appSource.indexOf("const loadMissionArchive = useCallback"),
      appSource.indexOf("const loadMissileAttackArchive", appSource.indexOf("const loadMissionArchive = useCallback")),
    );
    const refresher = appSource.slice(
      appSource.indexOf("const refreshMissionControl = useCallback"),
      appSource.indexOf("\n  useEffect(", appSource.indexOf("const refreshMissionControl = useCallback")),
    );

    expect(appSource).toContain("planetId: normalizedMissionFilters.planetId");
    expect(archiveLoader).not.toContain("activePlanetId");
    expect(refresher).not.toContain("activePlanetId");
    expect(appSource).toContain("onRefresh={() => void refreshMissionControl()}");
    expect(appSource).not.toContain('activePlanetSections.refresh("fleetVisibilityState")');
  });
});
