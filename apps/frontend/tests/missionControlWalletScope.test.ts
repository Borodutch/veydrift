import { describe, expect, test } from "bun:test";

describe("VEY-KANEO-836 Mission Control wallet scope", () => {
  test("keeps active and past mission state outside the selected-planet cache", async () => {
    const appSource = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();
    const stateStart = appSource.indexOf("// Mission Control is a commander-level surface.");
    const stateEnd = appSource.indexOf("const publicBattleReportsSnapshot", stateStart);
    const missionState = appSource.slice(stateStart, stateEnd);

    expect(stateStart).toBeGreaterThan(-1);
    expect(missionState).toContain("const fleetVisibilitySnapshot = useBackendDataSnapshot");
    expect(missionState).toContain("const missionArchiveSnapshot = useBackendDataSnapshot");
    expect(missionState).toContain("const allActiveMissionsSnapshot = useBackendDataSnapshot");
    expect(missionState).toContain("const globalMissionArchiveSnapshot = useBackendDataSnapshot");
    expect(missionState).toContain("const [missionPlanetArchetypesByCoordinate, setMissionPlanetArchetypesByCoordinate] = useState");
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
      appSource.indexOf("const refreshFinishedBuildingState", appSource.indexOf("const refreshMissionControl = useCallback")),
    );

    expect(archiveLoader).toContain("planetId: normalizedMissionFilters.planetId");
    expect(archiveLoader).not.toContain("activePlanetId");
    expect(refresher).not.toContain("activePlanetId");
    expect(appSource).toContain("onRefresh={() => void refreshMissionControl()}");
    expect(appSource).not.toContain('activePlanetSections.refresh("fleetVisibilityState")');
  });
});
