#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import {
  createPublicClient,
  decodeEventLog,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex
} from "viem";
import { base } from "viem/chains";

const migrationKindValid = 1;
const migrationKindHashOnly = 2;
const migrationKindRedemption = 3;
const zeroHash = `0x${"0".repeat(64)}`;

const referralAbi = parseAbi([
  "event ReferralInviteWindowActivated(address indexed inviter, bytes32 indexed codeHash, bytes32 indexed commitment, string code, uint64 activatedAt, uint64 activeUntil, bool migrated)",
  "event ReferralInviteRedeemed(address indexed inviter, address indexed invitee, bytes32 indexed commitment, uint256 rewardAmount, bool paid, bool credited, uint64 redeemedAt)",
  "event ReferralRewardClaimed(address indexed inviter, address indexed invitee, bytes32 indexed commitment, address recipient, uint256 amount, uint64 claimedAt)",
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
  if (message) console.error(message);
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

function normalizeCode(value, maxLength = 24) {
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

function redemptionLeaf(row) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint8" },
        { type: "address" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint64" }
      ],
      [
        migrationKindRedemption,
        row.inviter,
        row.invitee,
        row.commitment,
        BigInt(row.redeemedAt)
      ]
    )
  );
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
  return decoded.args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = await readInput(args.input);
  const sourceReferral = getAddress(input.sourceReferral);
  const snapshotBlock = BigInt(input.snapshotBlock);
  if (BigInt(input.indexCursorBlock) < snapshotBlock) throw new Error("Referral index is behind snapshot");

  const client = createPublicClient({ chain: base, transport: http(args["rpc-url"]) });
  const canonicalBlock = await rpcWithRetry(() => client.getBlock({ blockNumber: snapshotBlock }));
  const snapshotBlockHash = canonicalBlock.hash.toLowerCase();
  if (
    input.snapshotBlockHash
      && normalizeHex(input.snapshotBlockHash, 32, "snapshotBlockHash") !== snapshotBlockHash
  ) {
    throw new Error("Provided snapshot block hash is not canonical");
  }

  const [owner, game, referralSigner, finalized, sourceBalance] = await Promise.all([
    rpcWithRetry(() =>
      client.readContract({ address: sourceReferral, abi: referralAbi, functionName: "owner" })
    ),
    rpcWithRetry(() =>
      client.readContract({ address: sourceReferral, abi: referralAbi, functionName: "game" })
    ),
    rpcWithRetry(() =>
      client.readContract({
        address: sourceReferral,
        abi: referralAbi,
        functionName: "referralSigner"
      })
    ),
    rpcWithRetry(() => client.readContract({
      address: sourceReferral,
      abi: referralAbi,
      functionName: "referralMigrationFinalized"
    })),
    rpcWithRetry(() => client.getBalance({ address: sourceReferral, blockNumber: snapshotBlock }))
  ]);
  if (!finalized) throw new Error("Source referral migration is not finalized");
  if (sourceBalance !== 0n) throw new Error(`Source referral balance is ${sourceBalance}`);

  const claimEvents = input.claims
    .filter((event) => event.eventName === "ReferralInviteWindowActivated")
    .filter((event) => BigInt(event.blockNumber) <= snapshotBlock)
    .sort((left, right) => (chainOrder(left) < chainOrder(right) ? -1 : 1));
  const latestByCode = new Map();
  for (const event of claimEvents) {
    const decoded = await verifiedEvent(client, sourceReferral, event, "ReferralInviteWindowActivated");
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
      ? Number(BigInt(left.logIndex) - BigInt(right.logIndex))
      : Number(BigInt(left.activatedAt) - BigInt(right.activatedAt))
  );

  const latestByInviter = new Map();
  for (const row of validCodes) latestByInviter.set(row.inviter.toLowerCase(), row);
  const currentCommitments = await rpcWithRetry(() => client.multicall({
    allowFailure: false,
    blockNumber: snapshotBlock,
    contracts: [...latestByInviter.values()].map((row) => ({
      address: sourceReferral,
      abi: referralAbi,
      functionName: "referralCommitmentOf",
      args: [row.inviter]
    }))
  }));
  [...latestByInviter.values()].forEach((row, index) => {
    if (currentCommitments[index].toLowerCase() !== row.sourceCommitment) {
      throw new Error(`Current commitment mismatch for ${row.inviter}`);
    }
  });

  const hashOnlyByCode = new Map();
  for (const invite of input.legacyInvites ?? []) {
    if (typeof invite.txHash !== "string" || invite.code?.length !== 43) continue;
    const normalizedCode = normalizeCode(invite.code, 43);
    const codeHash = keccak256(stringToHex(normalizedCode));
    const sourceCommitment = keccak256(stringToHex(invite.code));
    if (normalizeHex(invite.commitment, 32, "legacy commitment") !== sourceCommitment) {
      throw new Error(`Legacy commitment mismatch for ${invite.code}`);
    }
    const row = {
      inviter: getAddress(invite.owner),
      code: invite.code,
      codeHash,
      sourceCommitment,
      transactionHash: normalizeHex(invite.txHash, 32, "legacy tx")
    };
    const existing = hashOnlyByCode.get(codeHash);
    if (existing && existing.inviter.toLowerCase() !== row.inviter.toLowerCase()) {
      throw new Error(`Hash-only ownership collision for ${invite.code}`);
    }
    hashOnlyByCode.set(codeHash, row);
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
        functionName: "referralMigrationExpectedHashOnlyHash"
      })),
      rpcWithRetry(() => client.readContract({
        address: sourceReferral,
        abi: referralAbi,
        functionName: "referralMigrationExpectedHashOnlyCount"
      })),
      rpcWithRetry(() => client.readContract({
        address: sourceReferral,
        abi: referralAbi,
        functionName: "referralMigrationImportedHashOnlyHash"
      })),
      rpcWithRetry(() => client.readContract({
        address: sourceReferral,
        abi: referralAbi,
        functionName: "referralMigrationImportedHashOnlyCount"
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
  const hashOnlyState = await rpcWithRetry(() => client.multicall({
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
  }));
  hashOnlyCodes.forEach((row, index) => {
    const codeOwner = hashOnlyState[index * 2];
    const migrationKind = hashOnlyState[index * 2 + 1];
    if (codeOwner.toLowerCase() !== row.inviter.toLowerCase() || Number(migrationKind) !== 2) {
      throw new Error(`Hash-only source state mismatch for ${row.code}`);
    }
  });

  const redemptions = [];
  for (const event of input.redemptions
    .filter((row) => row.eventName === "ReferralInviteRedeemed")
    .filter((row) => BigInt(row.blockNumber) <= snapshotBlock)
    .sort((left, right) => (chainOrder(left) < chainOrder(right) ? -1 : 1))) {
    const decoded = await verifiedEvent(client, sourceReferral, event, "ReferralInviteRedeemed");
    if (!decoded.paid || decoded.credited) {
      throw new Error(`Unsettled referral reward in ${event.transactionHash}`);
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
  if ((input.rewardClaims ?? []).length !== 0) {
    throw new Error("Source has referral reward claims; credit migration requires separate review");
  }
  const inviters = [...new Set(validCodes.map((row) => row.inviter.toLowerCase()))];
  const claimableAmounts = await rpcWithRetry(() => client.multicall({
    allowFailure: false,
    blockNumber: snapshotBlock,
    contracts: inviters.map((inviter) => ({
      address: sourceReferral,
      abi: referralAbi,
      functionName: "claimableReferralRewards",
      args: [getAddress(inviter)]
    }))
  }));
  inviters.forEach((inviter, index) => {
    const claimable = claimableAmounts[index];
    if (claimable !== 0n) throw new Error(`Outstanding referral credit for ${inviter}`);
  });

  const manifest = {
    version: 1,
    chainId: base.id,
    sourceReferral,
    sourceOwner: owner,
    sourceGame: game,
    sourceReferralSigner: referralSigner,
    snapshotBlock: snapshotBlock.toString(),
    snapshotBlockHash,
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
    rewardAudit: {
      rewardClaimEvents: 0,
      outstandingCreditsWei: "0",
      sourceBalanceWei: "0"
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
      redemptionRedeemedAts: redemptions.map((row) => row.redeemedAt)
    }
  };
  await writeFile(args.out, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(
    JSON.stringify({
      ok: true,
      out: args.out,
      snapshotBlock: manifest.snapshotBlock,
      validCodes: manifest.validCodeManifest.count,
      hashOnlyCodes: manifest.hashOnlyManifest.count,
      redemptions: manifest.redemptionManifest.count
    })
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
