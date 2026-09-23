import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  decodeFunctionData, encodeAbiParameters, encodeFunctionData, encodeFunctionResult,
  keccak256, multicall3Abi, parseAbi, parseAbiParameters, stringToHex,
  toEventSelector, toFunctionSelector,
} from "viem";
import { redemptionLeaf } from "./veydrift-referral-migration-manifest.mjs";

const source = "0x3333333333333333333333333333333333333333";
const owner = "0x1111111111111111111111111111111111111111";
const signer = "0x2222222222222222222222222222222222222222";
const recipient = "0x5555555555555555555555555555555555555555";
const invitees = ["0x4444444444444444444444444444444444444444", "0x6666666666666666666666666666666666666666", "0x7777777777777777777777777777777777777777"];
const code = "refcode";
const codeHash = keccak256(stringToHex(code));
const commitment = keccak256(encodeAbiParameters(parseAbiParameters("address,bytes32"), [owner, codeHash]));
const hash = (number) => `0x${number.toString(16).padStart(64, "0")}`;
const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const indexed = (address) => `0x${address.slice(2).padStart(64, "0")}`;
const zero = hash(0);
const claimMethod = parseAbi(["function migrateReferralRewardClaimHistory(address[] inviters,address[] invitees,bytes32[] commitments,address[] recipients,uint256[] amounts,uint64[] claimedAts)"]);
const redemptionTopic = toEventSelector("ReferralInviteRedeemed(address,address,bytes32,uint256,bool,bool,uint64)");
const importedTopic = toEventSelector("ReferralRedemptionImported(address,address,bytes32,uint64,bytes32)");
const claimedTopic = toEventSelector("ReferralRewardClaimed(address,address,bytes32,address,uint256,uint64)");
const activatedTopic = toEventSelector("ReferralInviteWindowActivated(address,bytes32,bytes32,string,uint64,uint64,bool)");
const rows = invitees.map((invitee, index) => ({
  inviter: owner, invitee, commitment, redeemedAt: String(6001 + index), rewardAmount: index === 2 ? "0" : "100",
  paid: index === 0, credited: index === 1,
}));

function fixture(hop, mutation = {}) {
  const logs = [];
  const transactions = new Map();
  const add = (block, index, topic, topics, data, input = "0x") => {
    const transactionHash = hash(block);
    const log = { address: source, blockNumber: `0x${block.toString(16)}`, blockHash: hash(block + 10000), transactionHash,
      logIndex: `0x${index.toString(16)}`, topics: [topic, ...topics], data };
    logs.push(log);
    transactions.set(transactionHash, input);
    return log;
  };
  const first = hop === 1 ? 6000 : 7000;
  add(first, 0, activatedTopic, [indexed(owner), codeHash, commitment],
    encodeAbiParameters(parseAbiParameters("string,uint64,uint64,bool"), [code, 6000n, 92400n, hop === 2]));
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const block = first + i + 1;
    if (hop === 2 || i === 2) {
      const leaf = hop === 1 ? keccak256(encodeAbiParameters(parseAbiParameters("uint8,address,address,bytes32,uint64"),
        [3, owner, row.invitee, commitment, BigInt(row.redeemedAt)])) : redemptionLeaf(row);
      add(block, 0, importedTopic, [indexed(owner), indexed(row.invitee), commitment],
        encodeAbiParameters(parseAbiParameters("uint64,bytes32"), [BigInt(row.redeemedAt),
          (mutation.badLeaf && i === 0) || (mutation.badLegacyLeaf && i === 2) ? hash(999) : leaf]));
    }
    if (hop === 2 || i !== 2) {
      add(block, hop === 2 ? 1 : 0, redemptionTopic, [indexed(owner), indexed(row.invitee), commitment],
        encodeAbiParameters(parseAbiParameters("uint256,bool,bool,uint64"),
          [BigInt(row.rewardAmount), row.paid, row.credited, BigInt(row.redeemedAt)]));
    }
  }
  const claimBlock = first + 4;
  const claimInput = encodeFunctionData({ abi: claimMethod, functionName: "migrateReferralRewardClaimHistory",
    args: [mutation.extraClaimRow ? [owner, owner] : [owner], mutation.extraClaimRow ? [invitees[1], invitees[0]] : [invitees[1]],
      mutation.extraClaimRow ? [commitment, commitment] : [commitment],
      mutation.extraClaimRow ? [recipient, recipient] : [mutation.badClaimCalldata ? owner : recipient],
      mutation.extraClaimRow ? [100n, 100n] : [100n], mutation.extraClaimRow ? [6004n, 6004n] : [6004n]] });
  add(claimBlock, 0, claimedTopic, [indexed(owner), indexed(invitees[1]), commitment],
    encodeAbiParameters(parseAbiParameters("address,uint256,uint64"), [recipient, 100n, mutation.badClaimTimestamp ? 6003n : 6004n]),
    hop === 2 && !mutation.unpairedClaim ? claimInput : "0x");
  if (mutation.unpairedRedemption) logs.splice(logs.findIndex((log) => log.topics[0] === importedTopic), 1);
  if (mutation.orphanImport) logs.splice(logs.findIndex((log) => log.topics[0] === redemptionTopic), 1);
  if (mutation.badOrdinaryTimestamp) {
    const ordinary = logs.find((log) => log.topics[0] === redemptionTopic && (hop === 1 || Number(BigInt(log.blockNumber)) === 7001));
    ordinary.data = encodeAbiParameters(parseAbiParameters("uint256,bool,bool,uint64"), [100n, true, false, 5999n]);
  }
  const claims = logs.filter((log) => log.topics[0] === activatedTopic);
  const redemptions = logs.filter((log) => log.topics[0] === redemptionTopic);
  const rewardClaims = logs.filter((log) => log.topics[0] === claimedTopic);
  const ref = (log, eventName) => ({ eventName, transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(), logIndex: BigInt(log.logIndex).toString() });
  return { logs, transactions, input: {
    sourceReferral: source, indexFromBlock: String(first), indexCursorBlock: String(claimBlock),
    snapshotBlock: String(claimBlock), snapshotBlockHash: hash(claimBlock + 10000),
    claims: claims.map((log) => ref(log, "ReferralInviteWindowActivated")),
    redemptions: redemptions.map((log) => ref(log, "ReferralInviteRedeemed")),
    rewardClaims: rewardClaims.map((log) => ref(log, "ReferralRewardClaimed")), legacyInvites: [],
  } };
}

function sourceRead(data) {
  const key = data.slice(0, 10).toLowerCase();
  const selector = (signature) => toFunctionSelector(signature);
  if (key === selector("aggregate3((address,bool,bytes)[])")) {
    const calls = decodeFunctionData({ abi: multicall3Abi, data }).args[0];
    return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: calls.map((call) => ({ success: true, returnData: sourceRead(call.callData) })) });
  }
  if (key === selector("owner()") || key === selector("referralCodeOwner(bytes32)") || key === selector("referralInvites(bytes32)")) return indexed(owner);
  if (key === selector("referralSigner()")) return indexed(signer);
  if (key === selector("referralCommitmentOf(address)")) return commitment;
  if (key === selector("referralCodeHashOf(bytes32)")) return codeHash;
  if (key === selector("referralClaimedAt(bytes32)")) return `0x${word(6000)}`;
  if (key === selector("referralMigrationFinalized()") || key === selector("referralRedemptions(bytes32,address)")
    || key === selector("referralInviteeRedeemed(address)")) return `0x${word(1)}`;
  if (key === selector("totalReferralRewardsAccrued(address)") || key === selector("totalReferralRewardsPaid(address)")) return `0x${word(200)}`;
  if (key === selector("totalReferralRewardsClaimed(address)")) return `0x${word(100)}`;
  if (key === selector("referralRedemptionQuota(bytes32)")) return `0x${word(0)}${word(92400)}`;
  return zero;
}

async function run(hop, mutation) {
  const { logs, transactions, input } = fixture(hop, mutation);
  const directory = mkdtempSync(join(tmpdir(), "referral-repeat-"));
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const reply = (item) => {
        const [first, second] = item.params ?? [];
        let result;
        switch (item.method) {
          case "eth_chainId": result = "0x2105"; break;
          case "eth_getBlockByNumber": {
            const number = first === "latest" ? Number(input.snapshotBlock) : Number(BigInt(first));
            result = { number: `0x${number.toString(16)}`, hash: hash(number + 10000), parentHash: hash(number + 9999),
              timestamp: `0x${(number < 7000 ? number : number + 10000).toString(16)}`,
              gasLimit: "0x1000000", gasUsed: "0x0", baseFeePerGas: "0x1", transactions: [] };
            break;
          }
          case "eth_getCode": result = second === `0x${(Number(input.indexFromBlock) - 1).toString(16)}` ? "0x" : "0x6000"; break;
          case "eth_getBalance": result = "0x0"; break;
          case "eth_getLogs": result = logs.filter((log) => BigInt(log.blockNumber) >= BigInt(first.fromBlock) && BigInt(log.blockNumber) <= BigInt(first.toBlock)); break;
          case "eth_getTransactionReceipt": {
            const matching = logs.filter((log) => log.transactionHash === first);
            if (!matching.length) throw new Error("Unexpected receipt");
            result = { transactionHash: first, status: "0x1", blockNumber: matching[0].blockNumber,
              blockHash: matching[0].blockHash, logs: matching, from: owner, to: source,
              transactionIndex: "0x0", gasUsed: "0x1", cumulativeGasUsed: "0x1" };
            break;
          }
          case "eth_getTransactionByHash": result = { hash: first, to: source, from: owner,
            input: transactions.get(first), blockNumber: `0x${BigInt(first).toString(16)}`,
            blockHash: hash(Number(BigInt(first)) + 10000), value: "0x0", gas: "0x100000", gasPrice: "0x1", nonce: "0x0", transactionIndex: "0x0" }; break;
          case "eth_call": result = sourceRead(first.data); break;
          default: throw new Error(`Unexpected method ${item.method}`);
        }
        return { jsonrpc: "2.0", id: item.id, result };
      };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(Array.isArray(payload) ? payload.map(reply) : reply(payload)));
    } catch (error) { response.statusCode = 500; response.end(String(error)); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const path = join(directory, "input.json");
  const out = join(directory, "manifest.json");
  writeFileSync(path, JSON.stringify(input));
  try {
    const address = server.address();
    const output = await new Promise((resolve) => {
      const child = spawn(process.execPath, [new URL("./veydrift-referral-migration-manifest.mjs", import.meta.url).pathname,
        "--rpc-url", `http://127.0.0.1:${address.port}`, "--input", path, "--out", out],
      { env: { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" } });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (code) => resolve({ code, stderr }));
    });
    return { ...output, manifest: output.code === 0 ? JSON.parse(readFileSync(out, "utf8")) : null };
  } finally { server.close(); rmSync(directory, { recursive: true, force: true }); }
}

test("source → replacement → replacement preserves paid, credited-then-claimed and zero history", async () => {
  const first = await run(1);
  assert.equal(first.code, 0, first.stderr);
  const second = await run(2);
  assert.equal(second.code, 0, second.stderr);
  for (const result of [first, second]) {
    assert.equal(result.manifest.redemptionManifest.count, 3);
    assert.equal(result.manifest.rewardClaimManifest.count, 1);
    assert.deepEqual(result.manifest.calldata.redemptionRewardAmounts, ["100", "100", "0"]);
    assert.deepEqual(result.manifest.calldata.redemptionPaid, [true, false, false]);
    assert.deepEqual(result.manifest.calldata.redemptionCredited, [false, true, false]);
    assert.deepEqual(result.manifest.calldata.rewardClaimAts, ["6004"]);
    assert.deepEqual(result.manifest.rewardStatsManifest.rows.map(({ accrued, paid, claimed }) => [accrued, paid, claimed]), [["200", "200", "100"]]);
  }
  assert.equal(first.manifest.redemptionManifest.digest, second.manifest.redemptionManifest.digest);
  assert.equal(first.manifest.rewardClaimManifest.digest, second.manifest.rewardClaimManifest.digest);
});

test("rejects unmatched, forged, and mismatched imported metadata", async () => {
  for (const [mutation, expected] of [
    [{ unpairedRedemption: true }, /missing import marker/],
    [{ orphanImport: true }, /Unpaired referral redemption import metadata mismatch/],
    [{ badLeaf: true }, /imported redemption metadata mismatch/],
    [{ unpairedClaim: true }, /no verified import calldata/],
    [{ extraClaimRow: true }, /imported reward claim inventory mismatch/],
    [{ badClaimTimestamp: true }, /imported reward claim calldata mismatch/],
    [{ badClaimCalldata: true }, /imported reward claim calldata mismatch/],
  ]) {
    const result = await run(2, mutation);
    assert.notEqual(result.code, 0, JSON.stringify(mutation));
    assert.match(result.stderr, expected);
  }
});

test("ordinary events still require canonical block timestamps", async () => {
  for (const mutation of [{ badOrdinaryTimestamp: true }, { badClaimTimestamp: true }]) {
    const result = await run(1, mutation);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /timestamp is not canonical/);
  }
  const legacy = await run(1, { badLegacyLeaf: true });
  assert.notEqual(legacy.code, 0);
  assert.match(legacy.stderr, /Unpaired referral redemption import metadata mismatch/);
});
