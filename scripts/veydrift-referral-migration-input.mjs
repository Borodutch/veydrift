#!/usr/bin/env node
// Builds the inventory input that veydrift-referral-migration-manifest.mjs cross-checks, straight
// from the source referral contract's canonical logs. No event carries a hash-only (43-character)
// preimage, so those are recovered from the source's own migrateLegacyReferralCodeOwnership
// calldata; the manifest generator re-verifies every row against its import receipt. Point this at
// a different RPC provider than the generator so the two log scans are independent.

import { chmod, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import process from "node:process";
import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  getAddress,
  http,
  keccak256,
  stringToHex,
  toEventSelector
} from "viem";
import { base } from "viem/chains";

import { referralAbi, rpcWithRetry } from "./veydrift-referral-migration-manifest.mjs";
import { safeDiagnosticText } from "./veydrift-safe-diagnostics.mjs";

const refLists = {
  ReferralInviteWindowActivated: "claims",
  ReferralInviteRedeemed: "redemptions",
  ReferralRewardClaimed: "rewardClaims"
};
const topics = new Map(referralAbi
  .filter((item) => item.type === "event"
    && (refLists[item.name] || item.name === "ReferralLegacyCodeOwnershipImported"))
  .map((item) => [toEventSelector(item).toLowerCase(), item.name]));

export async function buildReferralMigrationInput({
  client, sourceReferral, indexFromBlock, snapshotBlock, chunkSize = 1000n, previous
}) {
  const input = {
    sourceReferral,
    indexFromBlock: indexFromBlock.toString(),
    indexCursorBlock: snapshotBlock.toString(),
    snapshotBlock: snapshotBlock.toString(),
    snapshotBlockHash: (await rpcWithRetry(() => client.getBlock({ blockNumber: snapshotBlock }))).hash.toLowerCase(),
    claims: [],
    redemptions: [],
    rewardClaims: [],
    legacyInvites: []
  };
  let from = indexFromBlock;
  if (previous) {
    // Resume a scan taken before the freeze: only the blocks after it are read again.
    const previousBlock = BigInt(previous.snapshotBlock);
    if (getAddress(previous.sourceReferral) !== sourceReferral || previous.indexFromBlock !== input.indexFromBlock
      || previousBlock > snapshotBlock) throw new Error("Previous inventory does not prefix this scan");
    const previousHash = (await rpcWithRetry(() => client.getBlock({ blockNumber: previousBlock }))).hash;
    if (previousHash.toLowerCase() !== previous.snapshotBlockHash.toLowerCase()) {
      throw new Error("Previous inventory block is no longer canonical");
    }
    for (const key of ["claims", "redemptions", "rewardClaims", "legacyInvites"]) input[key].push(...previous[key]);
    from = previousBlock + 1n;
  }

  const legacyImports = new Map();
  for (let start = from; start <= snapshotBlock; start += chunkSize) {
    const end = start + chunkSize - 1n < snapshotBlock ? start + chunkSize - 1n : snapshotBlock;
    const logs = await rpcWithRetry(() => client.getLogs({ address: sourceReferral, fromBlock: start, toBlock: end }));
    for (const log of logs) {
      const eventName = topics.get(log.topics[0]?.toLowerCase());
      if (!eventName) continue;
      if (refLists[eventName]) {
        input[refLists[eventName]].push({
          eventName,
          transactionHash: log.transactionHash.toLowerCase(),
          blockNumber: BigInt(log.blockNumber).toString(),
          logIndex: BigInt(log.logIndex).toString()
        });
        continue;
      }
      const hash = log.transactionHash.toLowerCase();
      const { args } = decodeEventLog({ abi: referralAbi, eventName, data: log.data, topics: log.topics });
      legacyImports.set(hash, [...(legacyImports.get(hash) ?? []), args]);
    }
  }

  for (const [hash, events] of legacyImports) {
    const transaction = await rpcWithRetry(() => client.getTransaction({ hash }));
    let call;
    try {
      call = decodeFunctionData({ abi: referralAbi, data: transaction.input });
    } catch {
      call = undefined;
    }
    if (transaction.to?.toLowerCase() !== sourceReferral.toLowerCase()
      || call?.functionName !== "migrateLegacyReferralCodeOwnership") {
      throw new Error(`Hash-only import ${hash} is not a direct source import call; supply its preimages manually`);
    }
    const [inviters, codes] = call.args;
    for (const event of events) {
      const row = codes.findIndex((code) => keccak256(stringToHex(code)) === event.legacyCommitment.toLowerCase());
      if (row < 0 || getAddress(inviters[row]) !== getAddress(event.owner)) {
        throw new Error(`Hash-only import ${hash} has no calldata preimage for ${event.codeHash}`);
      }
      input.legacyInvites.push({
        owner: getAddress(event.owner),
        code: codes[row],
        commitment: event.legacyCommitment.toLowerCase(),
        importTxHash: hash
      });
    }
  }
  return input;
}

function usage(message) {
  if (message) console.error(safeDiagnosticText(message));
  console.error("Usage: veydrift-referral-migration-input.mjs --rpc-url <url> --source <address> "
    + "--index-from-block <n> --out <path> [--snapshot-block <n>] [--log-chunk-size <n>] [--previous <path>]");
  process.exit(2);
}

async function main() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) usage(`Invalid argument: ${argv[index] ?? ""}`);
    args[argv[index].slice(2)] = argv[index + 1];
  }
  if (!args["rpc-url"] || !args.source || !args["index-from-block"] || !args.out) usage();
  const client = createPublicClient({ chain: base, transport: http(args["rpc-url"]) });
  const chunkSize = BigInt(args["log-chunk-size"] ?? "1000");
  if (chunkSize < 1n || chunkSize > 50_000n) throw new Error("Invalid log chunk size");
  const input = await buildReferralMigrationInput({
    client,
    sourceReferral: getAddress(args.source),
    indexFromBlock: BigInt(args["index-from-block"]),
    snapshotBlock: args["snapshot-block"] ? BigInt(args["snapshot-block"]) : await client.getBlockNumber(),
    chunkSize,
    previous: args.previous ? JSON.parse(await readFile(args.previous, "utf8")) : undefined
  });
  await writeFile(args.out, `${JSON.stringify(input, null, 2)}\n`, { mode: 0o600 });
  await chmod(args.out, 0o600);
  console.log(JSON.stringify({
    ok: true,
    out: args.out,
    snapshotBlock: input.snapshotBlock,
    claims: input.claims.length,
    redemptions: input.redemptions.length,
    rewardClaims: input.rewardClaims.length,
    legacyInvites: input.legacyInvites.length
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(safeDiagnosticText(error));
    process.exit(1);
  });
}
