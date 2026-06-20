import { describe, expect, test } from "bun:test";

const playableSource = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();
const galaxySource = await Bun.file(new URL("../src/components/GalaxyView.tsx", import.meta.url)).text();
const planetDetailSource = await Bun.file(new URL("../src/components/PlanetDetail.tsx", import.meta.url)).text();

describe("Galaxy transaction gating", () => {
  test("threads shared transaction sync copy into mission entry and compose controls", () => {
    expect(playableSource).toContain("const missionLaunchStateBlocker = missionLaunchSubmitBlocker({");
    expect(playableSource).toContain("const missionLaunchBlocker = gameTransactionUnavailableReason ?? missionLaunchStateBlocker;");
    expect(playableSource).toContain("transactionUnavailableReason={gameTransactionUnavailableReason}");
    expect(galaxySource).toContain("transactionUnavailableReason?: string | undefined;");
    expect(galaxySource).toContain("{transactionUnavailableReason ? (");
    expect(galaxySource).toContain('busy={actionState.status === "pending" || Boolean(transactionUnavailableReason)}');
    expect(galaxySource).toContain("busyReason={transactionUnavailableReason}");
    expect(galaxySource).toContain("title={busyReason ?? (action.enabled ? action.label : action.reason)}");
    expect(planetDetailSource).toContain("transactionUnavailableReason?: string | undefined;");
    expect(planetDetailSource).toContain("{transactionUnavailableReason ? (");
    expect(planetDetailSource).toContain("busyReason={transactionUnavailableReason}");
  });
});
