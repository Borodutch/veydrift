// Local-only real-component fixture for tests/riftPage.browser.mjs. No wallet, API, or production entry imports this file.
// ?state=loading (skeleton), ?state=locked (no Rift Stabilizer, the QA account's live shape) or ?state=unlocked (workbench, claims and history).
import { render } from "preact";
import { RiftPage } from "../../src/components/RiftPage";
import type { ChainRiftState } from "../../src/walletFlow";
import "../../src/styles.css";

const now = 1_794_840_000_000;
const state = new URLSearchParams(location.search).get("state");
const unlocked = state === "unlocked";
const resource = (key: "metal" | "crystal" | "deuterium", resourceId: number, inGameBalance: string) => ({
  key, label: key[0]!.toUpperCase() + key.slice(1), resourceId, tokenAddress: null, walletBalance: null, allowance: null, inGameBalance, lockedBalance: "0",
});
const riftState: ChainRiftState = {
  wallet: "0x3727851a5d93ccd4e5c82ed71368af044f138a69",
  homePlanetId: "83",
  riftAvailable: true,
  unlocked,
  withdrawalDelaySeconds: "2419200",
  requirements: [
    { kind: "building", key: "interdimensionalRiftStabilizer", label: "Rift Stabilizer", currentLevel: unlocked ? 1 : 0, requiredLevel: 1, binary: true, built: unlocked },
    { kind: "building", key: "roboticsFactory", label: "Robotics Factory", currentLevel: 9, requiredLevel: 4 },
    { kind: "building", key: "researchLab", label: "Research Lab", currentLevel: 7, requiredLevel: 2 },
    { kind: "technology", key: "energy", label: "Energy Technology", currentLevel: 6, requiredLevel: 5 },
    { kind: "technology", key: "hyperspace", label: "Hyperspace Technology", currentLevel: unlocked ? 1 : 0, requiredLevel: 1 },
  ],
  resources: [resource("metal", 0, "71680123456"), resource("crystal", 1, "30040987654"), resource("deuterium", 2, "15173456789")],
  pendingWithdrawals: unlocked ? [
    { id: "1", planetId: "83", resource: "metal", amount: "1234567890", startedAmount: "1500000000", requestedAt: "2026-11-01T00:00:00Z", unlocksAt: "2026-11-29T00:00:00Z", ready: false },
    { id: "2", planetId: "84", resource: "deuterium", amount: "987654321", requestedAt: "2026-10-01T00:00:00Z", unlocksAt: "2026-10-29T00:00:00Z", ready: true },
  ] : [],
  history: unlocked ? [
    { id: "h1", kind: "raided", planetId: "83", amounts: { metal: "265432110", crystal: "123456789", deuterium: "98765432" }, counterparty: "0x1234567890abcdef1234567890abcdef12345678", unlocksAt: null, occurredAt: "2026-11-05T12:00:00Z", transactionHash: null },
    { id: "h2", kind: "extractionStarted", planetId: "83", amounts: { metal: "1500000000", crystal: "0", deuterium: "0" }, counterparty: null, unlocksAt: "2026-11-29T00:00:00Z", occurredAt: "2026-11-01T00:00:00Z", transactionHash: null },
  ] : [],
};
const planets = [
  { planetId: "83", name: "Homeworld Prime", coordinates: { galaxy: 1, system: 42, position: 7 } },
  { planetId: "84", name: "Long Colony Name Outpost", coordinates: { galaxy: 1, system: 43, position: 9 }, buildingLevels: [{ id: 15, level: 1 }] },
] as never;
const noop = () => undefined;

document.body.style.background = "#05070d";
render(
  <main className="min-w-0 max-w-full p-3 sm:p-4 lg:p-6">
    <RiftPage
      account={riftState.wallet}
      actionState={{ status: "idle" }}
      canTransact
      loading={state === "loading"}
      now={now}
      onApprove={noop}
      onDeposit={noop}
      onFinishWithdrawal={noop}
      onOpenRaidFinder={noop}
      onOpenRequirement={noop}
      onRefresh={noop}
      onRequestWithdrawal={noop}
      onSelectPlanet={noop}
      planets={planets}
      riftState={state === "loading" ? null : riftState}
    />
  </main>,
  document.getElementById("app")!,
);
