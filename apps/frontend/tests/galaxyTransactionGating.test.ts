import { describe, expect, test } from "bun:test";

const playableSource = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();
const galaxySource = await Bun.file(new URL("../src/components/GalaxyView.tsx", import.meta.url)).text();
const planetDetailSource = await Bun.file(new URL("../src/components/PlanetDetail.tsx", import.meta.url)).text();
const inspectSource = await Bun.file(new URL("../src/components/InspectPages.tsx", import.meta.url)).text();

describe("Galaxy transaction gating", () => {
  test("threads shared transaction sync copy into mission entry and compose controls", () => {
    expect(playableSource).toContain("const missionLaunchStateBlocker = missionLaunchSubmitBlocker({");
    expect(playableSource).toContain("const missionLaunchBlocker = missionTransactionUnavailableReason ?? missionLaunchStateBlocker;");
    expect(playableSource).toContain("transactionUnavailableReason={missionTransactionUnavailableReason}");
    expect(galaxySource).toContain("transactionUnavailableReason?: string | undefined;");
    expect(galaxySource).toContain("{transactionUnavailableReason ? (");
    expect(galaxySource).toContain('busy={actionState.status === "pending" || Boolean(transactionUnavailableReason)}');
    expect(galaxySource).toContain("busyReason={transactionUnavailableReason}");
    expect(galaxySource).toContain("title={busyReason ?? (action.enabled ? action.label : action.reason)}");
    expect(planetDetailSource).toContain("transactionUnavailableReason?: string | undefined;");
    expect(planetDetailSource).toContain("{transactionUnavailableReason ? (");
    expect(planetDetailSource).toContain("busyReason={transactionUnavailableReason}");
  });

  test("keeps attackability surfaces free of two-score comparison copy", () => {
    for (const source of [galaxySource, planetDetailSource, inspectSource]) {
      expect(source).not.toContain("scoreComparisonLabel");
      expect(source).not.toContain("Protection score");
      expect(source).not.toContain(" vs ");
    }
    expect(galaxySource).not.toContain("scoreComparisonText");
    expect(planetDetailSource).not.toContain("scoreComparisonText");
    expect(inspectSource).not.toContain("scoreComparisonText");
  });
});
