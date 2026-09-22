#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createPublicClient,
  decodeEventLog,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toEventSelector,
  zeroAddress,
} from "viem";

const rpcUrl = process.env.RPC_URL;
const historicalRpcUrl = process.env.HISTORICAL_RPC_URL ?? rpcUrl;
const sourceAddressInput = process.env.LEGACY_PAID_ALLIANCE_INVITE_ADDRESS;
const indexFromBlockInput = process.env.PAID_ALLIANCE_INVITE_INDEX_FROM_BLOCK;
const outputInput = process.env.PAID_ALLIANCE_INVITE_MIGRATION_MANIFEST_FILE;
if (!rpcUrl || !sourceAddressInput || !indexFromBlockInput || !outputInput) {
  throw new Error(
    "RPC_URL, LEGACY_PAID_ALLIANCE_INVITE_ADDRESS, PAID_ALLIANCE_INVITE_INDEX_FROM_BLOCK, and PAID_ALLIANCE_INVITE_MIGRATION_MANIFEST_FILE are required; HISTORICAL_RPC_URL is optional",
  );
}

const sourceAddress = getAddress(sourceAddressInput);
const indexFromBlock = BigInt(indexFromBlockInput);
const outputPath = resolve(outputInput);
const client = createPublicClient({ transport: http(rpcUrl) });
const historicalClient = createPublicClient({ transport: http(historicalRpcUrl) });
const abi = parseAbi([
  "function alliance() view returns (address)",
  "function owner() view returns (address)",
  "function signer() view returns (address)",
  "function invite(bytes32) view returns ((uint256 allianceId,address purchaser,uint128 settlementPrice,uint64 purchasedAt,bool redeemed))",
  "function issuingAllianceOf(address) view returns (uint256)",
  "function bonusBalance(uint256) view returns ((uint128 metal,uint128 crystal,uint128 deuterium))",
  "function pendingBonusBalance(uint256) view returns ((uint128 metal,uint128 crystal,uint128 deuterium))",
  "event PaidAllianceInvitePurchased(bytes32 indexed commitment,uint256 indexed allianceId,address indexed purchaser,uint256 settlementPrice,uint64 purchasedAt)",
  "event PaidAllianceInviteRedeemed(bytes32 indexed commitment,uint256 indexed allianceId,address indexed invitee,address purchaser,uint64 redeemedAt)",
]);
const allianceAbi = parseAbi(["function game() view returns (address)"]);
const gameAbi = parseAbi(["function gamePaused() view returns (bool)"]);
const migrationParameters = parseAbiParameters(
  "(bytes32 commitment,(uint256 allianceId,address purchaser,uint128 settlementPrice,uint64 purchasedAt,bool redeemed) invite,address invitee,uint64 redeemedAt)[] invites,(address invitee,uint256 allianceId,(uint16 metal,uint16 crystal,uint16 deuterium) remainder)[] issuances,(uint256 allianceId,(uint128 metal,uint128 crystal,uint128 deuterium) balance,(uint128 metal,uint128 crystal,uint128 deuterium) pendingBalance)[] balances",
);

const snapshotBlock = await client.getBlockNumber();
const snapshot = await client.getBlock({ blockNumber: snapshotBlock });
const chainId = await client.getChainId();
if (await historicalClient.getChainId() !== chainId) {
  throw new Error("historical RPC chain does not match the snapshot RPC chain");
}
const historicalSnapshot = await historicalClient.getBlock({ blockNumber: snapshotBlock });
if (historicalSnapshot.hash !== snapshot.hash) {
  throw new Error("historical RPC disagrees with the frozen snapshot block");
}
// Prove the supplied start block cannot omit any purchase or redemption event.
// A provider without archival code at this block must fail closed, not silently omit invites.
if (indexFromBlock > 0n) {
  const codeBefore = await historicalClient.getCode({
    address: sourceAddress,
    blockNumber: indexFromBlock - 1n,
  });
  if (codeBefore && codeBefore !== "0x") {
    throw new Error("index-from-block is later than the legacy contract deployment");
  }
}
const sourceCode = await client.getCode({ address: sourceAddress, blockNumber: snapshotBlock });
if (!sourceCode || sourceCode === "0x") {
  throw new Error("legacy paid-invite contract is not deployed at the snapshot block");
}
const [allianceAddress, owner, signer] = await Promise.all([
  client.readContract({ address: sourceAddress, abi, functionName: "alliance", blockNumber: snapshotBlock }),
  client.readContract({ address: sourceAddress, abi, functionName: "owner", blockNumber: snapshotBlock }),
  client.readContract({ address: sourceAddress, abi, functionName: "signer", blockNumber: snapshotBlock }),
]);
if (owner === zeroAddress || signer === zeroAddress) throw new Error("legacy owner/signer is unset");
const gameAddress = await client.readContract({
  address: allianceAddress,
  abi: allianceAbi,
  functionName: "game",
  blockNumber: snapshotBlock,
});
const gamePaused = await client.readContract({
  address: gameAddress,
  abi: gameAbi,
  functionName: "gamePaused",
  blockNumber: snapshotBlock,
});
if (!gamePaused) throw new Error("game must be paused before taking the migration snapshot");
const sourceBalance = await client.getBalance({ address: sourceAddress, blockNumber: snapshotBlock });
if (sourceBalance !== 0n) throw new Error("legacy paid-invite contract holds unmigrated ETH");
const gameBalance = await client.getBalance({ address: gameAddress, blockNumber: snapshotBlock });

const logs = [];
const chunkSize = BigInt(process.env.PAID_ALLIANCE_INVITE_LOG_CHUNK_SIZE ?? "1000");
if (chunkSize < 1n || chunkSize > 50_000n) throw new Error("invalid paid-invite log chunk size");
for (let fromBlock = indexFromBlock; fromBlock <= snapshotBlock; fromBlock += chunkSize) {
  const toBlock = fromBlock + chunkSize - 1n < snapshotBlock
    ? fromBlock + chunkSize - 1n
    : snapshotBlock;
  logs.push(...await historicalClient.getLogs({ address: sourceAddress, fromBlock, toBlock }));
}

const purchases = new Map();
const redemptions = new Map();
const purchaseTopic = toEventSelector(abi.find((item) => item.type === "event" && item.name === "PaidAllianceInvitePurchased"));
const redemptionTopic = toEventSelector(abi.find((item) => item.type === "event" && item.name === "PaidAllianceInviteRedeemed"));
for (const log of logs) {
  if (log.topics[0] !== purchaseTopic && log.topics[0] !== redemptionTopic) continue;
  // A malformed canonical event is a hard failure, not a skipped state entry.
  const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
  if (decoded.eventName === "PaidAllianceInvitePurchased") {
    const commitment = decoded.args.commitment.toLowerCase();
    if (purchases.has(commitment)) throw new Error(`duplicate purchase ${commitment}`);
    purchases.set(commitment, decoded.args);
  } else if (decoded.eventName === "PaidAllianceInviteRedeemed") {
    const commitment = decoded.args.commitment.toLowerCase();
    if (redemptions.has(commitment)) throw new Error(`duplicate redemption ${commitment}`);
    redemptions.set(commitment, decoded.args);
  }
}
if (purchases.size === 0) throw new Error("no legacy paid-invite purchases found");

const invites = [];
const issuanceByInvitee = new Map();
const allianceIds = new Set();
for (const [commitment, purchase] of [...purchases.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const invite = await client.readContract({
    address: sourceAddress,
    abi,
    functionName: "invite",
    args: [commitment],
    blockNumber: snapshotBlock,
  });
  if (
    invite.allianceId !== purchase.allianceId
    || invite.purchaser.toLowerCase() !== purchase.purchaser.toLowerCase()
    || invite.settlementPrice !== purchase.settlementPrice
    || invite.purchasedAt !== purchase.purchasedAt
  ) throw new Error(`purchase state mismatch ${commitment}`);
  const redemption = redemptions.get(commitment);
  if (invite.redeemed !== Boolean(redemption)) throw new Error(`redemption state mismatch ${commitment}`);
  const invitee = redemption?.invitee ?? zeroAddress;
  const redeemedAt = redemption?.redeemedAt ?? 0n;
  invites.push({ commitment, invite, invitee, redeemedAt });
  allianceIds.add(invite.allianceId.toString());
  if (redemption) {
    const key = invitee.toLowerCase();
    if (issuanceByInvitee.has(key)) throw new Error(`multiple redeemed invites for ${invitee}`);
    issuanceByInvitee.set(key, { invitee, allianceId: invite.allianceId });
  }
}
for (const commitment of redemptions.keys()) {
  if (!purchases.has(commitment)) throw new Error(`redemption without purchase ${commitment}`);
}

const issuances = [];
for (const { invitee, allianceId } of [...issuanceByInvitee.values()].sort((a, b) =>
  a.invitee.toLowerCase().localeCompare(b.invitee.toLowerCase()))) {
  const actualAllianceId = await client.readContract({
    address: sourceAddress,
    abi,
    functionName: "issuingAllianceOf",
    args: [invitee],
    blockNumber: snapshotBlock,
  });
  if (actualAllianceId !== allianceId) throw new Error(`issuance state mismatch ${invitee}`);
  const slot = keccak256(encodeAbiParameters(parseAbiParameters("address,uint256"), [invitee, 6n]));
  const packed = BigInt(await client.getStorageAt({ address: sourceAddress, slot, blockNumber: snapshotBlock }) ?? "0x0");
  issuances.push({
    invitee,
    allianceId,
    remainder: {
      metal: packed & 0xffffn,
      crystal: (packed >> 16n) & 0xffffn,
      deuterium: (packed >> 32n) & 0xffffn,
    },
  });
}

const balances = [];
for (const allianceIdText of [...allianceIds].sort((a, b) =>
  BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0)) {
  const allianceId = BigInt(allianceIdText);
  const [balance, pendingBalance] = await Promise.all([
    client.readContract({ address: sourceAddress, abi, functionName: "bonusBalance", args: [allianceId], blockNumber: snapshotBlock }),
    client.readContract({ address: sourceAddress, abi, functionName: "pendingBonusBalance", args: [allianceId], blockNumber: snapshotBlock }),
  ]);
  balances.push({ allianceId, balance, pendingBalance });
}

const migrationData = encodeAbiParameters(migrationParameters, [invites, issuances, balances]);
const stateHash = keccak256(migrationData);
const manifest = {
  schemaVersion: 1,
  chainId,
  sourcePaidInviteSystem: sourceAddress,
  allianceProxy: allianceAddress,
  game: gameAddress,
  gameBalance,
  sourceBalance,
  owner,
  signer,
  indexFromBlock,
  snapshotBlock: { number: snapshotBlock, hash: snapshot.hash },
  counts: { invites: invites.length, issuances: issuances.length, balances: balances.length },
  stateHash,
  migrationData,
  invites,
  issuances,
  balances,
};
const json = JSON.stringify(manifest, (_, value) => typeof value === "bigint" ? value.toString() : value, 2);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${json}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputPath, stateHash, counts: manifest.counts, snapshotBlock: snapshotBlock.toString() }));
