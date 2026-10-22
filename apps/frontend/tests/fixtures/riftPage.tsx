// Local-only Rift page with fixture state and a stubbed Base RPC. No wallet, API or signing.
import { render } from "preact";
import { useState } from "preact/hooks";
import { RiftPage } from "../../src/components/RiftPage";
import type { ChainRiftState, RiftHistoryEntry } from "../../src/walletFlow";
import "../../src/styles.css";

const locked = new URLSearchParams(location.search).get("state") === "locked";
const now = Date.parse("2026-10-20T20:00:00.000Z");
const day = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const rpcUrl = "https://rpc.rift.test/";
const signer = "0x2222222222222222222222222222222222222222";
const tokens = {
  metal: "0x5555555555555555555555555555555555555555",
  crystal: "0x6666666666666666666666666666666666666666",
  deuterium: "0x7777777777777777777777777777777777777777",
};

// What the stubbed RPC answers for balanceOf / allowance, by token.
const chain = {
  balance: { [tokens.metal]: 12_500_000n, [tokens.crystal]: 0n, [tokens.deuterium]: 3_000_000n } as Record<string, bigint>,
  allowance: { [tokens.metal]: 0n, [tokens.crystal]: 0n, [tokens.deuterium]: 0n } as Record<string, bigint>,
};
const calls = { approve: [] as string[], deposit: [] as string[], extract: [] as string[], finalize: [] as string[], select: [] as string[], rpc: 0 };
(window as any).riftFixture = { calls };

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url !== rpcUrl) return realFetch(input, init);
  calls.rpc += 1;
  const request = JSON.parse(String(init?.body)) as { id: number; params: [{ to: string; data: string }] };
  const { to, data } = request.params[0];
  const value = (data.startsWith("0x70a08231") ? chain.balance : chain.allowance)[to.toLowerCase()] ?? 0n;
  return new Response(JSON.stringify({ id: request.id, jsonrpc: "2.0", result: `0x${value.toString(16).padStart(64, "0")}` }), {
    headers: { "content-type": "application/json" },
  });
};

const amounts = (metal = "0", crystal = "0", deuterium = "0") => ({ metal, crystal, deuterium });
const history: RiftHistoryEntry[] = [
  { id: "raided", kind: "raided", planetId: "1", amounts: amounts("400000"), counterparty: "0x9999999999999999999999999999999999999999", unlocksAt: null, occurredAt: iso(now - 2 * day), transactionHash: "0x01" },
  { id: "started-metal", kind: "extractionStarted", planetId: "1", amounts: amounts("1000000"), counterparty: null, unlocksAt: iso(now + 20 * day), occurredAt: iso(now - 8 * day), transactionHash: "0x02" },
  { id: "injected", kind: "injected", planetId: "1", amounts: amounts("0", "0", "2000000"), counterparty: null, unlocksAt: null, occurredAt: iso(now - 9 * day), transactionHash: "0x03" },
  { id: "started-crystal", kind: "extractionStarted", planetId: "2", amounts: amounts("0", "250000"), counterparty: null, unlocksAt: iso(now - day), occurredAt: iso(now - 29 * day), transactionHash: "0x04" },
  { id: "raid", kind: "raid", planetId: "77", amounts: amounts("120000", "80000"), counterparty: "0x8888888888888888888888888888888888888888", unlocksAt: null, occurredAt: iso(now - 30 * day), transactionHash: "0x05" },
];

const riftState: ChainRiftState = {
  wallet: signer,
  homePlanetId: "1",
  riftAvailable: true,
  unlocked: !locked,
  withdrawalDelaySeconds: "2419200",
  requirements: [
    { kind: "building", key: "interdimensionalRiftStabilizer", label: "Rift Stabilizer", currentLevel: locked ? 0 : 1, requiredLevel: 1, binary: true, built: !locked },
    { kind: "building", key: "roboticsFactory", label: "Robotics Factory", currentLevel: 5, requiredLevel: 4 },
    { kind: "building", key: "researchLab", label: "Research Lab", currentLevel: 2, requiredLevel: 2 },
    { kind: "technology", key: "energy", label: "Energy Technology", currentLevel: 4, requiredLevel: 5 },
    { kind: "technology", key: "hyperspace", label: "Hyperspace Technology", currentLevel: 1, requiredLevel: 1 },
  ],
  resources: [
    { key: "metal", label: "Metal", resourceId: 0, tokenAddress: tokens.metal, walletBalance: null, allowance: null, inGameBalance: "184250", lockedBalance: "600000" },
    { key: "crystal", label: "Crystal", resourceId: 1, tokenAddress: tokens.crystal, walletBalance: null, allowance: null, inGameBalance: "96400", lockedBalance: "0" },
    { key: "deuterium", label: "Deuterium", resourceId: 2, tokenAddress: tokens.deuterium, walletBalance: null, allowance: null, inGameBalance: "41870", lockedBalance: "0" },
  ],
  pendingWithdrawals: [
    { id: "extraction:1:0", kind: "riftExtraction", planetId: "1", resource: "metal", amount: "600000", startedAmount: "1000000", requestedAt: iso(now - 8 * day), unlocksAt: iso(now + 20 * day), ready: false },
    { id: "extraction:2:1", kind: "riftExtraction", planetId: "2", resource: "crystal", amount: "250000", startedAmount: "250000", requestedAt: iso(now - 29 * day), unlocksAt: iso(now - day), ready: true },
  ],
  history,
};

const planets = [
  { planetId: "1", name: "Aurora Prime", coordinates: "4:120:7", buildingLevels: [{ id: 15, level: locked ? 0 : 1 }] },
  { planetId: "2", name: "Kestrel Reach", coordinates: "4:121:3", buildingLevels: [{ id: 15, level: 1 }] },
];

type ActionState = { status: "idle" } | { status: "success"; label: string };

function Fixture() {
  const [actionState, setActionState] = useState<ActionState>({ status: "idle" });
  return (
    <RiftPage
      account={signer}
      actionState={actionState}
      canTransact
      gameContract="0x3333333333333333333333333333333333333333"
      loading={false}
      now={now}
      onApprove={(transfers) => {
        for (const { resource, amount } of transfers) {
          calls.approve.push(`${resource.key}:${amount}`);
          // The approval confirms: the game may now take exactly this amount.
          chain.allowance[resource.tokenAddress!] = amount;
        }
        setActionState({ status: "success", label: "Approvals confirmed." });
      }}
      onDeposit={(transfers) => calls.deposit.push(...transfers.map(({ resource, amount }) => `${resource.key}:${amount}`))}
      onFinishWithdrawal={(claim) => calls.finalize.push(claim.id)}
      onOpenRequirement={() => {}}
      onRefresh={() => {}}
      onRequestWithdrawal={(transfers) => calls.extract.push(...transfers.map(({ resource, amount }) => `${resource.key}:${amount}`))}
      onSelectPlanet={(planetId) => calls.select.push(planetId)}
      planets={planets}
      riftState={riftState}
      rpcUrl={rpcUrl}
      signerAccount={signer}
    />
  );
}

render(<Fixture />, document.getElementById("app")!);
