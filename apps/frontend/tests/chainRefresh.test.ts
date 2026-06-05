import { describe, expect, test } from "bun:test";
import {
  beginRefreshRequest,
  canApplyRefreshRequest,
  markFreshStateWrite,
  shouldRefreshAllianceStateForPage,
} from "../src/PlayableMvpApp";

describe("playable chain refresh", () => {
  test("uses backend chain events instead of the old fast unconditional polling loops", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(source).toContain("new window.EventSource");
    expect(source).toContain("/chain/events");
    expect(source).toContain("snapshot.subscribedToHeads && snapshot.subscribedToLogs");
    expect(source).toContain("120_000");
    expect(source).not.toContain("30_000");
    expect(source).not.toContain("2_500");
  });

  test("polls the canonical wallet resource snapshot for the hydrated top bar", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(source).toContain("TOP_BAR_RESOURCE_POLL_INTERVAL_MS = 10_000");
    expect(source).toContain("refreshTopBarResources");
    expect(source).toContain("document.visibilityState === \"hidden\"");
    expect(source).toContain("refreshOnChainState()");
    expect(source).toContain("refreshInfrastructureState()");
    expect(source).toContain("onChainRefreshGate");
    expect(source).toContain("infrastructureRefreshGate");
    expect(source).toContain("canApplyRefreshRequest");
    expect(source).toContain("markFreshStateWrite");
  });

  test("blocks older top-bar poll refreshes after newer transaction state writes", () => {
    const gate = { current: 0 };
    const olderPollRequest = beginRefreshRequest(gate);

    expect(canApplyRefreshRequest(gate, olderPollRequest)).toBe(true);

    markFreshStateWrite(gate);

    expect(canApplyRefreshRequest(gate, olderPollRequest)).toBe(false);

    const newerPollRequest = beginRefreshRequest(gate);

    expect(canApplyRefreshRequest(gate, newerPollRequest)).toBe(true);
  });

  test("refreshes alliance state for rankings so same-alliance rows can highlight", () => {
    expect(shouldRefreshAllianceStateForPage("rankings")).toBe(true);
    expect(shouldRefreshAllianceStateForPage("alliance")).toBe(true);
    expect(shouldRefreshAllianceStateForPage("alliance-inspect")).toBe(true);
    expect(shouldRefreshAllianceStateForPage("overview")).toBe(false);
  });

  test("does not create browser-side gameplay read providers for transaction preflights", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();
    const walletFlowSource = await Bun.file(new URL("../src/walletFlow.ts", import.meta.url)).text();

    expect(source).not.toContain("baseSepoliaReadProvider");
    expect(source).not.toContain("transactionReadProvider");
    expect(source).not.toContain("{ readProvider }");
    expect(source).not.toContain("receiptProvider");
    expect(source).not.toContain("waitForReceipt(");
    expect(walletFlowSource).not.toContain("eth_getTransactionReceipt");
    expect(walletFlowSource).not.toContain("waitForReceipt(");
    expect(source).toContain("sendStartBuildingUpgradeTransaction(\n          provider,\n          account,\n          gameContract,\n          planetId,\n          building,\n        )");
    expect(source).not.toContain("building,\n          { readProvider },");
    expect(source).toContain("sendFinishBuildingUpgradeTransaction(\n          provider,\n          account,\n          gameContract,\n          planetId,\n        )");
    expect(source).not.toContain("sendCollectResourcesTransaction");
  });
});
