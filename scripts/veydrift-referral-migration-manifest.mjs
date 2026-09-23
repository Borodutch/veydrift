#!/usr/bin/env node

import { chmod, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import process from "node:process";
import {
  createPublicClient,
  decodeEventLog,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex,
  toEventSelector
} from "viem";
import { base } from "viem/chains";

import { safeDiagnosticText } from "./veydrift-safe-diagnostics.mjs";

const migrationKindValid = 1;
const migrationKindHashOnly = 2;
const migrationKindRedemption = 3;
const migrationKindRewardStats = 4;
const migrationKindRewardClaim = 5;
const migrationKindRedemptionHistory = 6;
const zeroHash = `0x${"0".repeat(64)}`;

const referralAbi = parseAbi([
  "event ReferralInviteWindowActivated(address indexed inviter, bytes32 indexed codeHash, bytes32 indexed commitment, string code, uint64 activatedAt, uint64 activeUntil, bool migrated)",
  "event ReferralInviteRedeemed(address indexed inviter, address indexed invitee, bytes32 indexed commitment, uint256 rewardAmount, bool paid, bool credited, uint64 redeemedAt)",
  "event ReferralRedemptionImported(address indexed inviter,address indexed invitee,bytes32 indexed commitment,uint64 redeemedAt,bytes32 manifestLeaf)",
  "event ReferralRewardClaimed(address indexed inviter, address indexed invitee, bytes32 indexed commitment, address recipient, uint256 amount, uint64 claimedAt)",
  "event ReferralLegacyCodeOwnershipImported(address indexed owner, bytes32 indexed codeHash, bytes32 indexed legacyCommitment, bytes32 manifestLeaf)",
  "function referralInvites(bytes32 commitment) view returns (address inviter)",
  "function referralCodeHashOf(bytes32 commitment) view returns (bytes32)",
  "function referralClaimedAt(bytes32 commitment) view returns (uint64)",
  "function referralRedemptions(bytes32 commitment,address invitee) view returns (bool)",
  "function referralInviteeRedeemed(address invitee) view returns (bool)",
  "function referralRedemptionQuota(bytes32 commitment) view returns (uint8 remainingRedemptions,uint64 nextRedemptionAt)",
  "function referralRewardCredits(bytes32 commitment,address invitee) view returns (uint256)",
  "function totalReferralRewardsAccrued(address inviter) view returns (uint256)",
  "function totalReferralRewardsPaid(address inviter) view returns (uint256)",
  "function totalReferralRewardsClaimed(address inviter) view returns (uint256)",
  "function owner() view returns (address)",
  "function game() view returns (address)",
  "function referralSigner() view returns (address)",
  "function referralMigrationFinalized() view returns (bool)",
  "function referralMigrationExpectedHashOnlyHash() view returns (bytes32)",
  "function referralMigrationExpectedHashOnlyCount() view returns (uint32)",
  "function referralMigrationImportedHashOnlyHash() view returns (bytes32)",
  "function referralMigrationImportedHashOnlyCount() view returns (uint32)",
  "function referralCodeOwner(bytes32 codeHash) view returns (address)",
  "function referralCodeMigrationKind(bytes32 codeHash) view returns (uint8)",
  "function referralCommitmentOf(address inviter) view returns (bytes32)",
  "function claimableReferralRewards(address inviter) view returns (uint256)"
]);

function usage(message) {
  if (message) console.error(safeDiagnosticText(message));
  console.error(
    "Usage: veydrift-referral-migration-manifest.mjs --rpc-url <url> --input <path|-> --out <path>"
  );
  process.exit(2);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) usage(`Invalid argument: ${key ?? ""}`);
    parsed[key.slice(2)] = value;
  }
  if (!parsed["rpc-url"] || !parsed.input || !parsed.out) usage();
  return parsed;
}

async function readInput(path) {
  if (path !== "-") return JSON.parse(await readFile(path, "utf8"));
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function normalizeHex(value, bytes, label) {
  const pattern = new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`);
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${label} is invalid`);
  return value.toLowerCase();
}

export function normalizeCode(value, maxLength = 24) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new Error(`Referral code length must be 1-${maxLength}`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Referral code has invalid characters");
  return value.toLowerCase();
}

function chainOrder(event) {
  return BigInt(event.blockNumber) * 1_000_000n + BigInt(event.logIndex);
}

function xorHashes(hashes) {
  const value = hashes.reduce((result, hash) => result ^ BigInt(hash), 0n);
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function validLeaf(row) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint8" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint64" }
      ],
      [migrationKindValid, row.inviter, row.codeHash, row.sourceCommitment, BigInt(row.activatedAt)]
    )
  );
}

function hashOnlyLeaf(row) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint8" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" }
      ],
      [migrationKindHashOnly, row.inviter, row.codeHash, row.sourceCommitment]
    )
  );
}

export function rewardStatsLeaf(row) {
  return keccak256(encodeAbiParameters(
    [{ type: "uint8" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [migrationKindRewardStats, row.inviter, BigInt(row.accrued), BigInt(row.paid), BigInt(row.claimed)]
  ));
}

export function redemptionLeaf(row) {
  return keccak256(encodeAbiParameters(
    [{ type: "uint8" }, { type: "address" }, { type: "address" }, { type: "bytes32" },
      { type: "uint64" }, { type: "uint256" }, { type: "bool" }, { type: "bool" }],
    [migrationKindRedemptionHistory, row.inviter, row.invitee, row.commitment,
      BigInt(row.redeemedAt), BigInt(row.rewardAmount), row.paid, row.credited]
  ));
}

export function rewardClaimLeaf(row) {
  return keccak256(encodeAbiParameters(
    [{ type: "uint8" }, { type: "address" }, { type: "address" }, { type: "bytes32" },
      { type: "address" }, { type: "uint256" }, { type: "uint64" }],
    [migrationKindRewardClaim, row.inviter, row.invitee, row.commitment,
      row.recipient, BigInt(row.amount), BigInt(row.claimedAt)]
  ));
}

async function receiptWithRetry(client, hash) {
  return rpcWithRetry(() => client.getTransactionReceipt({ hash }));
}

async function rpcWithRetry(action) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function verifiedEvent(client, sourceReferral, event, eventName) {
  const transactionHash = normalizeHex(event.transactionHash, 32, "transactionHash");
  const expectedLogIndex = Number(BigInt(event.logIndex));
  const receipt = await receiptWithRetry(client, transactionHash);
  if (receipt.status !== "success") throw new Error(`${transactionHash} did not succeed`);
  const log = receipt.logs.find(
    (candidate) =>
      candidate.address.toLowerCase() === sourceReferral.toLowerCase()
      && candidate.logIndex === expectedLogIndex
  );
  if (!log) throw new Error(`${transactionHash}:${event.logIndex} is not a source referral log`);
  const decoded = decodeEventLog({ abi: referralAbi, eventName, data: log.data, topics: log.topics });
  if (decoded.eventName !== eventName) {
    throw new Error(`${transactionHash}:${event.logIndex} decoded as ${decoded.eventName}`);
  }
  if (receipt.blockNumber !== BigInt(event.blockNumber)) {
    throw new Error(`${transactionHash}:${event.logIndex} block mismatch`);
  }
  const block = await rpcWithRetry(() => client.getBlock({ blockNumber: receipt.blockNumber }));
  if (receipt.blockHash.toLowerCase() !== block.hash.toLowerCase()) throw new Error(`${transactionHash} is not canonical`);
  const timestamp = eventName === "ReferralInviteWindowActivated" && !decoded.args.migrated ? decoded.args.activatedAt
    : eventName === "ReferralInviteRedeemed" ? decoded.args.redeemedAt
      : eventName === "ReferralRewardClaimed" ? decoded.args.claimedAt : undefined;
  if (timestamp !== undefined && timestamp !== block.timestamp) throw new Error(`${transactionHash} event timestamp is not canonical`);
  return decoded.args;
}

const trackedReferralEvents = [
  "ReferralInviteWindowActivated", "ReferralLegacyCodeOwnershipImported",
  "ReferralInviteRedeemed", "ReferralRedemptionImported", "ReferralRewardClaimed"
];
const trackedTopics = new Map(referralAbi.filter((item) => item.type === "event" && trackedReferralEvents.includes(item.name))
  .map((item) => [toEventSelector(item).toLowerCase(), item.name]));

export function assertIndexedRefs(inputEvents, canonicalEvents, name) {
  const references = (events) => events.map((event) =>
    `${normalizeHex(event.transactionHash, 32, "transactionHash")}:${BigInt(event.logIndex)}`).sort();
  const listed = references((inputEvents ?? []).filter((event) => event.eventName === name));
  const canonical = references(canonicalEvents.filter((event) => event.eventName === name));
  if (JSON.stringify(listed) !== JSON.stringify(canonical)) {
    throw new Error(`${name} index inventory disagrees with canonical source logs`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = await readInput(args.input);
  const sourceReferral = getAddress(input.sourceReferral);
  const snapshotBlock = BigInt(input.snapshotBlock);
  const indexFromBlock = BigInt(input.indexFromBlock);
  if (indexFromBlock < 1n || indexFromBlock > snapshotBlock) throw new Error("Invalid referral index-from block");
  if (BigInt(input.indexCursorBlock) < snapshotBlock) throw new Error("Referral index is behind snapshot");
  const expectedSnapshotHash = normalizeHex(input.snapshotBlockHash, 32, "snapshotBlockHash");

  const client = createPublicClient({ chain: base, transport: http(args["rpc-url"]) });
  const historicalClient = createPublicClient({ chain: base, transport: http(args["historical-rpc-url"] ?? args["rpc-url"]) });
  const canonicalBlock = await rpcWithRetry(() => client.getBlock({ blockNumber: snapshotBlock }));
  const snapshotBlockHash = canonicalBlock.hash.toLowerCase();
  if (expectedSnapshotHash !== snapshotBlockHash) throw new Error("Provided snapshot block hash is not canonical");
  if ((await rpcWithRetry(() => historicalClient.getBlock({ blockNumber: snapshotBlock }))).hash.toLowerCase() !== snapshotBlockHash) {
    throw new Error("Historical RPC disagrees with snapshot block");
  }
  const codeBefore = await rpcWithRetry(() => historicalClient.getCode({ address: sourceReferral, blockNumber: indexFromBlock - 1n }));
  if (codeBefore && codeBefore !== "0x") throw new Error("Referral index starts after source deployment");
  const sourceCode = await rpcWithRetry(() => historicalClient.getCode({ address: sourceReferral, blockNumber: snapshotBlock }));
  if (!sourceCode || sourceCode === "0x") throw new Error("Frozen referral source has no code");
  const chunkSize = BigInt(args["log-chunk-size"] ?? "1000");
  if (chunkSize < 1n || chunkSize > 50_000n) throw new Error("Invalid historical log chunk size");
  const canonicalEvents = [];
  for (let from = indexFromBlock; from <= snapshotBlock; from += chunkSize) {
    const to = from + chunkSize - 1n < snapshotBlock ? from + chunkSize - 1n : snapshotBlock;
    const logs = await rpcWithRetry(() => historicalClient.getLogs({ address: sourceReferral, fromBlock: from, toBlock: to }));
    for (const log of logs) {
      const eventName = trackedTopics.get(log.topics[0]?.toLowerCase());
      if (eventName) canonicalEvents.push({ eventName, transactionHash: log.transactionHash, blockNumber: log.blockNumber.toString(), logIndex: log.logIndex.toString() });
    }
  }
  assertIndexedRefs(input.claims, canonicalEvents, "ReferralInviteWindowActivated");
  assertIndexedRefs(input.redemptions, canonicalEvents, "ReferralInviteRedeemed");
  assertIndexedRefs(input.rewardClaims, canonicalEvents, "ReferralRewardClaimed");
  if (canonicalEvents.length > 100_000) throw new Error("Unbounded referral event inventory");

  const [owner, game, referralSigner, finalized, sourceBalance] = await Promise.all([
    rpcWithRetry(() =>
      client.readContract({ address: sourceReferral, abi: referralAbi, functionName: "owner", blockNumber: snapshotBlock })
    ),
    rpcWithRetry(() =>
      client.readContract({ address: sourceReferral, abi: referralAbi, functionName: "game", blockNumber: snapshotBlock })
    ),
    rpcWithRetry(() =>
      client.readContract({
        address: sourceReferral,
        abi: referralAbi,
        functionName: "referralSigner", blockNumber: snapshotBlock
      })
    ),
    rpcWithRetry(() => client.readContract({
      address: sourceReferral,
      abi: referralAbi,
      functionName: "referralMigrationFinalized", blockNumber: snapshotBlock
    })),
    rpcWithRetry(() => client.getBalance({ address: sourceReferral, blockNumber: snapshotBlock }))
  ]);
  if (!finalized) throw new Error("Source referral migration is not finalized");
  if (game.toLowerCase() !== "0x0000000000000000000000000000000000000000") throw new Error("Source referral system is not frozen");
  if (sourceBalance !== 0n) throw new Error(`Source referral balance is ${sourceBalance}`);

  const claimEvents = canonicalEvents
    .filter((event) => event.eventName === "ReferralInviteWindowActivated")
    .filter((event) => BigInt(event.blockNumber) <= snapshotBlock)
    .sort((left, right) => (chainOrder(left) < chainOrder(right) ? -1 : 1));
  const latestByCode = new Map();
  for (const event of claimEvents) {
    const decoded = await verifiedEvent(historicalClient, sourceReferral, event, "ReferralInviteWindowActivated");
    const inviter = getAddress(decoded.inviter);
    const normalizedCode = normalizeCode(decoded.code);
    const codeHash = keccak256(stringToHex(normalizedCode));
    const sourceCommitment = normalizeHex(decoded.commitment, 32, "claim commitment");
    const canonicalCommitment = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "bytes32" }],
        [inviter, codeHash]
      )
    );
    if (normalizeHex(decoded.codeHash, 32, "claim codeHash") !== codeHash) {
      throw new Error(`Code hash mismatch in ${event.transactionHash}`);
    }
    if (sourceCommitment !== canonicalCommitment) {
      throw new Error(`Noncanonical source commitment in ${event.transactionHash}`);
    }
    const row = {
      inviter,
      code: decoded.code,
      codeHash,
      sourceCommitment,
      activatedAt: decoded.activatedAt.toString(),
      transactionHash: normalizeHex(event.transactionHash, 32, "claim tx"),
      blockNumber: BigInt(event.blockNumber).toString(),
      logIndex: BigInt(event.logIndex).toString()
    };
    const existing = latestByCode.get(codeHash);
    if (existing && existing.inviter.toLowerCase() !== inviter.toLowerCase()) {
      throw new Error(`Code ownership collision for ${normalizedCode}`);
    }
    latestByCode.set(codeHash, row);
  }
  const validCodes = [...latestByCode.values()].sort((left, right) =>
    BigInt(left.activatedAt) === BigInt(right.activatedAt)
      ? chainOrder(left) < chainOrder(right) ? -1 : 1
      : BigInt(left.activatedAt) < BigInt(right.activatedAt) ? -1 : 1
  );

  const latestByInviter = new Map();
  for (const row of validCodes) latestByInviter.set(row.inviter.toLowerCase(), row);
  const currentCommitments = latestByInviter.size ? await rpcWithRetry(() => client.multicall({
    allowFailure: false,
    blockNumber: snapshotBlock,
    contracts: [...latestByInviter.values()].map((row) => ({
      address: sourceReferral,
      abi: referralAbi,
      functionName: "referralCommitmentOf",
      args: [row.inviter]
    }))
  })) : [];
  [...latestByInviter.values()].forEach((row, index) => {
    if (currentCommitments[index].toLowerCase() !== row.sourceCommitment) {
      throw new Error(`Current commitment mismatch for ${row.inviter}`);
    }
  });

  const validState = validCodes.length ? await rpcWithRetry(() => client.multicall({
    allowFailure: false,
    blockNumber: snapshotBlock,
    contracts: validCodes.flatMap((row) => [
      { address: sourceReferral, abi: referralAbi, functionName: "referralCodeOwner", args: [row.codeHash] },
      { address: sourceReferral, abi: referralAbi, functionName: "referralCodeMigrationKind", args: [row.codeHash] },
      { address: sourceReferral, abi: referralAbi, functionName: "referralInvites", args: [row.sourceCommitment] },
      { address: sourceReferral, abi: referralAbi, functionName: "referralCodeHashOf", args: [row.sourceCommitment] },
      { address: sourceReferral, abi: referralAbi, functionName: "referralClaimedAt", args: [row.sourceCommitment] }
    ])
  })) : [];
  validCodes.forEach((row, index) => {
    const [codeOwner, migrationKind, inviteOwner, codeHash, activatedAt] = validState.slice(index * 5, index * 5 + 5);
    if (
      codeOwner.toLowerCase() !== row.inviter.toLowerCase() || Number(migrationKind) === 2
        || inviteOwner.toLowerCase() !== row.inviter.toLowerCase()
        || codeHash.toLowerCase() !== row.codeHash || activatedAt !== BigInt(row.activatedAt)
    ) throw new Error(`Valid-code source state mismatch for ${row.code}`);
  });

  const hashOnlyEvents = new Map();
  for (const event of canonicalEvents.filter((row) => row.eventName === "ReferralLegacyCodeOwnershipImported")) {
    const decoded = await verifiedEvent(historicalClient, sourceReferral, event, "ReferralLegacyCodeOwnershipImported");
    const codeHash = normalizeHex(decoded.codeHash, 32, "hash-only source code hash");
    if (hashOnlyEvents.has(codeHash)) throw new Error(`Duplicate hash-only source import ${codeHash}`);
    hashOnlyEvents.set(codeHash, { owner: getAddress(decoded.owner), commitment: normalizeHex(decoded.legacyCommitment, 32, "hash-only source commitment"), transactionHash: normalizeHex(event.transactionHash, 32, "hash-only import tx"), logIndex: event.logIndex });
  }
  const hashOnlyByCode = new Map();
  for (const invite of input.legacyInvites ?? []) {
    if (typeof invite.importTxHash !== "string" || invite.code?.length !== 43) {
      throw new Error("Hash-only preimage requires its source import receipt");
    }
    const normalizedCode = normalizeCode(invite.code, 43);
    const codeHash = keccak256(stringToHex(normalizedCode));
    const sourceCommitment = keccak256(stringToHex(invite.code));
    if (normalizeHex(invite.commitment, 32, "legacy commitment") !== sourceCommitment) {
      throw new Error(`Legacy commitment mismatch for ${invite.code}`);
    }
    const importEvent = hashOnlyEvents.get(codeHash);
    if (
      !importEvent || importEvent.owner.toLowerCase() !== getAddress(invite.owner).toLowerCase()
        || importEvent.commitment !== sourceCommitment
        || importEvent.transactionHash !== normalizeHex(invite.importTxHash, 32, "hash-only import tx")
    ) throw new Error(`Hash-only preimage has no matching source import receipt for ${invite.code}`);
    const row = {
      inviter: getAddress(invite.owner),
      code: invite.code,
      codeHash,
      sourceCommitment,
      transactionHash: importEvent.transactionHash,
      logIndex: importEvent.logIndex
    };
    const existing = hashOnlyByCode.get(codeHash);
    if (existing && existing.inviter.toLowerCase() !== row.inviter.toLowerCase()) {
      throw new Error(`Hash-only ownership collision for ${invite.code}`);
    }
    hashOnlyByCode.set(codeHash, row);
  }
  if (hashOnlyByCode.size !== hashOnlyEvents.size) {
    throw new Error("Hash-only preimage inventory omits source import events");
  }
  const hashOnlyCodes = [...hashOnlyByCode.values()].sort((left, right) =>
    left.codeHash.localeCompare(right.codeHash)
  );
  const hashOnlyDigest = xorHashes(hashOnlyCodes.map(hashOnlyLeaf));
  const [expectedHashOnlyHash, expectedHashOnlyCount, importedHashOnlyHash, importedHashOnlyCount] =
    await Promise.all([
      rpcWithRetry(() => client.readContract({
        address: sourceReferral,
        abi: referralAbi,
        functionName: "referralMigrationExpectedHashOnlyHash", blockNumber: snapshotBlock
      })),
      rpcWithRetry(() => client.readContract({
        address: sourceReferral,
        abi: referralAbi,
        functionName: "referralMigrationExpectedHashOnlyCount", blockNumber: snapshotBlock
      })),
      rpcWithRetry(() => client.readContract({
        address: sourceReferral,
        abi: referralAbi,
        functionName: "referralMigrationImportedHashOnlyHash", blockNumber: snapshotBlock
      })),
      rpcWithRetry(() => client.readContract({
        address: sourceReferral,
        abi: referralAbi,
        functionName: "referralMigrationImportedHashOnlyCount", blockNumber: snapshotBlock
      }))
    ]);
  if (
    hashOnlyCodes.length !== Number(expectedHashOnlyCount)
      || importedHashOnlyCount !== expectedHashOnlyCount
      || hashOnlyDigest !== expectedHashOnlyHash.toLowerCase()
      || importedHashOnlyHash.toLowerCase() !== expectedHashOnlyHash.toLowerCase()
  ) {
    throw new Error("Hash-only inventory does not match the source contract's reviewed manifest");
  }
  const hashOnlyState = hashOnlyCodes.length ? await rpcWithRetry(() => client.multicall({
    allowFailure: false,
    blockNumber: snapshotBlock,
    contracts: hashOnlyCodes.flatMap((row) => [
      {
        address: sourceReferral,
        abi: referralAbi,
        functionName: "referralCodeOwner",
        args: [row.codeHash]
      },
      {
        address: sourceReferral,
        abi: referralAbi,
        functionName: "referralCodeMigrationKind",
        args: [row.codeHash]
      }
    ])
  })) : [];
  hashOnlyCodes.forEach((row, index) => {
    const codeOwner = hashOnlyState[index * 2];
    const migrationKind = hashOnlyState[index * 2 + 1];
    if (codeOwner.toLowerCase() !== row.inviter.toLowerCase() || Number(migrationKind) !== 2) {
      throw new Error(`Hash-only source state mismatch for ${row.code}`);
    }
  });

  const redemptions = [];
  for (const event of canonicalEvents
    .filter((row) => row.eventName === "ReferralInviteRedeemed")
    .filter((row) => BigInt(row.blockNumber) <= snapshotBlock)
    .sort((left, right) => (chainOrder(left) < chainOrder(right) ? -1 : 1))) {
    const decoded = await verifiedEvent(historicalClient, sourceReferral, event, "ReferralInviteRedeemed");
    if (decoded.paid === decoded.credited || decoded.rewardAmount === 0n) {
      throw new Error(`Invalid referral reward status in ${event.transactionHash}`);
    }
    redemptions.push({
      inviter: getAddress(decoded.inviter),
      invitee: getAddress(decoded.invitee),
      commitment: normalizeHex(decoded.commitment, 32, "redemption commitment"),
      redeemedAt: decoded.redeemedAt.toString(),
      rewardAmount: decoded.rewardAmount.toString(),
      paid: decoded.paid,
      credited: decoded.credited,
      transactionHash: normalizeHex(event.transactionHash, 32, "redemption tx"),
      blockNumber: BigInt(event.blockNumber).toString(),
      logIndex: BigInt(event.logIndex).toString()
    });
  }
  for (const event of canonicalEvents.filter((row) => row.eventName === "ReferralRedemptionImported")) {
    const decoded = await verifiedEvent(historicalClient, sourceReferral, event, "ReferralRedemptionImported");
    redemptions.push({
      inviter: getAddress(decoded.inviter), invitee: getAddress(decoded.invitee),
      commitment: normalizeHex(decoded.commitment, 32, "imported commitment"),
      redeemedAt: decoded.redeemedAt.toString(), rewardAmount: "0", paid: false,
      credited: false, transactionHash: normalizeHex(event.transactionHash, 32, "redemption import tx"),
      blockNumber: BigInt(event.blockNumber).toString(), logIndex: BigInt(event.logIndex).toString()
    });
  }
  redemptions.sort((a, b) => chainOrder(a) < chainOrder(b) ? -1 : 1);
  const rewardsByPair = new Map();
  const seenInvitees = new Set();
  const rewardStatsByInviter = new Map();
  const ensureStats = (inviter) => {
    const key = inviter.toLowerCase();
    if (!rewardStatsByInviter.has(key)) rewardStatsByInviter.set(key, { inviter: getAddress(inviter), accrued: 0n, paid: 0n, claimed: 0n });
    return rewardStatsByInviter.get(key);
  };
  for (const row of validCodes) ensureStats(row.inviter);
  for (const row of redemptions) {
    const key = `${row.commitment}:${row.invitee.toLowerCase()}`;
    if (rewardsByPair.has(key) || seenInvitees.has(row.invitee.toLowerCase())) {
      throw new Error(`Duplicate referral redemption or invitee ${key}`);
    }
    seenInvitees.add(row.invitee.toLowerCase());
    rewardsByPair.set(key, { ...row, outstanding: row.credited ? BigInt(row.rewardAmount) : 0n });
    const stats = ensureStats(row.inviter);
    stats.accrued += BigInt(row.rewardAmount);
    if (row.paid) stats.paid += BigInt(row.rewardAmount);
  }
  const rewardClaims = [];
  for (const event of canonicalEvents.filter((row) => row.eventName === "ReferralRewardClaimed")) {
    const decoded = await verifiedEvent(historicalClient, sourceReferral, event, "ReferralRewardClaimed");
    const key = `${normalizeHex(decoded.commitment, 32, "reward commitment")}:${getAddress(decoded.invitee).toLowerCase()}`;
    const redemption = rewardsByPair.get(key);
    if (!redemption || !redemption.credited || redemption.outstanding !== decoded.amount || decoded.amount === 0n
      || chainOrder(event) <= chainOrder(redemption)
      || redemption.inviter.toLowerCase() !== getAddress(decoded.inviter).toLowerCase()
      || decoded.recipient === "0x0000000000000000000000000000000000000000") {
      throw new Error(`Reward claim does not settle one credited redemption ${event.transactionHash}`);
    }
    redemption.outstanding = 0n;
    const stats = ensureStats(redemption.inviter);
    stats.paid += decoded.amount;
    stats.claimed += decoded.amount;
    rewardClaims.push({
      ...event, inviter: redemption.inviter, invitee: redemption.invitee,
      commitment: redemption.commitment, recipient: getAddress(decoded.recipient),
      amount: decoded.amount.toString(), claimedAt: decoded.claimedAt.toString()
    });
  }
  const redemptionState = redemptions.length ? await rpcWithRetry(() => client.multicall({
    allowFailure: false,
    blockNumber: snapshotBlock,
    contracts: redemptions.flatMap((row) => [
      { address: sourceReferral, abi: referralAbi, functionName: "referralRedemptions", args: [row.commitment, row.invitee] },
      { address: sourceReferral, abi: referralAbi, functionName: "referralInviteeRedeemed", args: [row.invitee] },
      { address: sourceReferral, abi: referralAbi, functionName: "referralRewardCredits", args: [row.commitment, row.invitee] }
    ])
  })) : [];
  redemptions.forEach((row, index) => {
    const state = redemptionState.slice(index * 3, index * 3 + 3);
    if (!state[0] || !state[1] || state[2] !== 0n
      || rewardsByPair.get(`${row.commitment}:${row.invitee.toLowerCase()}`).outstanding !== 0n) {
      throw new Error(`Source redemption or credit state mismatch for ${row.commitment}`);
    }
  });

  const rewardStats = [...rewardStatsByInviter.values()].sort((a, b) => a.inviter.toLowerCase().localeCompare(b.inviter.toLowerCase()));
  const sourceStats = rewardStats.length ? await rpcWithRetry(() => client.multicall({
    allowFailure: false,
    blockNumber: snapshotBlock,
    contracts: rewardStats.flatMap((row) => [
      { address: sourceReferral, abi: referralAbi, functionName: "claimableReferralRewards", args: [row.inviter] },
      { address: sourceReferral, abi: referralAbi, functionName: "totalReferralRewardsAccrued", args: [row.inviter] },
      { address: sourceReferral, abi: referralAbi, functionName: "totalReferralRewardsPaid", args: [row.inviter] },
      { address: sourceReferral, abi: referralAbi, functionName: "totalReferralRewardsClaimed", args: [row.inviter] }
    ])
  })) : [];
  rewardStats.forEach((row, index) => {
    const [claimable, accrued, paid, claimed] = sourceStats.slice(index * 4, index * 4 + 4);
    if (claimable !== 0n || accrued !== row.accrued || paid !== row.paid || claimed !== row.claimed || row.accrued !== row.paid) {
      throw new Error(`Frozen source reward accounting mismatch for ${row.inviter}`);
    }
  });
  const quotaState = latestByInviter.size ? await rpcWithRetry(() => client.multicall({
    allowFailure: false,
    blockNumber: snapshotBlock,
    contracts: [...latestByInviter.values()].map((row) => ({
      address: sourceReferral, abi: referralAbi, functionName: "referralRedemptionQuota", args: [row.sourceCommitment]
    }))
  })) : [];
  [...latestByInviter.values()].forEach((row, index) => {
    const used = redemptions.filter((item) => item.commitment === row.sourceCommitment && BigInt(item.redeemedAt) >= BigInt(row.activatedAt)).length;
    const [remaining, nextAt] = quotaState[index];
    if (used > 3 || Number(remaining) !== 3 - used || nextAt !== (used === 3 ? BigInt(row.activatedAt) + 86_400n : 0n)) {
      throw new Error(`Frozen source redemption quota mismatch for ${row.inviter}`);
    }
  });

  if ((await rpcWithRetry(() => client.getBlock({ blockNumber: snapshotBlock }))).hash.toLowerCase() !== snapshotBlockHash) {
    throw new Error("Frozen snapshot block reorged during verification");
  }
  const [currentOwner, currentGame, currentSigner, currentBalance] = await Promise.all([
    client.readContract({ address: sourceReferral, abi: referralAbi, functionName: "owner" }),
    client.readContract({ address: sourceReferral, abi: referralAbi, functionName: "game" }),
    client.readContract({ address: sourceReferral, abi: referralAbi, functionName: "referralSigner" }),
    client.getBalance({ address: sourceReferral })
  ]);
  if (currentOwner.toLowerCase() !== owner.toLowerCase() || currentSigner.toLowerCase() !== referralSigner.toLowerCase()
    || currentGame.toLowerCase() !== game.toLowerCase() || currentBalance !== 0n) {
    throw new Error("Frozen source owner, signer, Game pointer or escrow changed during verification");
  }

  const manifest = {
    version: 2,
    chainId: base.id,
    sourceReferral,
    sourceOwner: owner,
    sourceGame: game,
    sourceReferralSigner: referralSigner,
    snapshotBlock: snapshotBlock.toString(),
    snapshotBlockHash,
    indexFromBlock: indexFromBlock.toString(),
    sourceBalanceWei: sourceBalance.toString(),
    validCodeManifest: {
      count: validCodes.length,
      digest: xorHashes(validCodes.map(validLeaf)),
      rows: validCodes
    },
    hashOnlyManifest: {
      count: hashOnlyCodes.length,
      digest: hashOnlyDigest,
      rows: hashOnlyCodes
    },
    redemptionManifest: {
      count: redemptions.length,
      digest: xorHashes(redemptions.map(redemptionLeaf)),
      rows: redemptions
    },
    rewardClaimManifest: {
      count: rewardClaims.length,
      digest: xorHashes(rewardClaims.map(rewardClaimLeaf)),
      rows: rewardClaims
    },
    rewardStatsManifest: {
      count: rewardStats.length,
      digest: xorHashes(rewardStats.map(rewardStatsLeaf)),
      rows: rewardStats.map((row) => ({ inviter: row.inviter, accrued: row.accrued.toString(), paid: row.paid.toString(), claimed: row.claimed.toString() }))
    },
    rewardAudit: {
      rewardClaimEvents: rewardClaims.length,
      creditedRedemptions: redemptions.filter((row) => row.credited).length,
      outstandingCreditsWei: "0",
      sourceBalanceWei: sourceBalance.toString()
    },
    calldata: {
      validInviters: validCodes.map((row) => row.inviter),
      validCodes: validCodes.map((row) => row.code),
      validActivatedAts: validCodes.map((row) => row.activatedAt),
      validSourceCommitments: validCodes.map((row) => row.sourceCommitment),
      hashOnlyInviters: hashOnlyCodes.map((row) => row.inviter),
      hashOnlyCodes: hashOnlyCodes.map((row) => row.code),
      hashOnlySourceCommitments: hashOnlyCodes.map((row) => row.sourceCommitment),
      redemptionInviters: redemptions.map((row) => row.inviter),
      redemptionInvitees: redemptions.map((row) => row.invitee),
      redemptionCommitments: redemptions.map((row) => row.commitment),
      redemptionRedeemedAts: redemptions.map((row) => row.redeemedAt),
      redemptionRewardAmounts: redemptions.map((row) => row.rewardAmount),
      redemptionPaid: redemptions.map((row) => row.paid),
      redemptionCredited: redemptions.map((row) => row.credited),
      rewardClaimInviters: rewardClaims.map((row) => row.inviter),
      rewardClaimInvitees: rewardClaims.map((row) => row.invitee),
      rewardClaimCommitments: rewardClaims.map((row) => row.commitment),
      rewardClaimRecipients: rewardClaims.map((row) => row.recipient),
      rewardClaimAmounts: rewardClaims.map((row) => row.amount),
      rewardClaimAts: rewardClaims.map((row) => row.claimedAt),
      rewardInviters: rewardStats.map((row) => row.inviter),
      rewardAccrued: rewardStats.map((row) => row.accrued.toString()),
      rewardPaid: rewardStats.map((row) => row.paid.toString()),
      rewardClaimed: rewardStats.map((row) => row.claimed.toString())
    }
  };
  await writeFile(args.out, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await chmod(args.out, 0o600);
  console.log(
    JSON.stringify({
      ok: true,
      out: args.out,
      snapshotBlock: manifest.snapshotBlock,
      validCodes: manifest.validCodeManifest.count,
      hashOnlyCodes: manifest.hashOnlyManifest.count,
      redemptions: manifest.redemptionManifest.count,
      rewardClaims: manifest.rewardClaimManifest.count,
      rewardStats: manifest.rewardStatsManifest.count
    })
  );
}

export function reportReferralMigrationFailure(error) {
  console.error(safeDiagnosticText(error));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    reportReferralMigrationFailure(error);
    process.exit(1);
  });
}
