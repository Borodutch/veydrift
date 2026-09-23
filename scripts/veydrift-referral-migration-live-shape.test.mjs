import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  decodeFunctionData, encodeAbiParameters, encodeFunctionResult, keccak256,
  multicall3Abi, parseAbiParameters, stringToHex, toEventSelector, toFunctionSelector,
} from "viem";

const source = "0x3333333333333333333333333333333333333333";
const owner = "0x1111111111111111111111111111111111111111";
const signer = "0x2222222222222222222222222222222222222222";
const invitee = "0x4444444444444444444444444444444444444444";
const code = "refcode";
const codeHash = keccak256(stringToHex(code));
const commitment = keccak256(encodeAbiParameters(parseAbiParameters("address,bytes32"), [owner, codeHash]));
const txClaim = `0x${"12".repeat(32)}`;
const txRedeem = `0x${"13".repeat(32)}`;
const hash16 = `0x${"22".repeat(32)}`;
const hash17 = `0x${"33".repeat(32)}`;
const zero = `0x${"0".repeat(64)}`;
const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const indexed = (address) => `0x${address.slice(2).padStart(64, "0")}`;
const claimLog = {
  address: source, blockNumber: "0x1770", blockHash: hash16, transactionHash: txClaim, logIndex: "0x0",
  topics: [toEventSelector("ReferralInviteWindowActivated(address,bytes32,bytes32,string,uint64,uint64,bool)"), indexed(owner), codeHash, commitment],
  data: encodeAbiParameters(parseAbiParameters("string,uint64,uint64,bool"), [code, 6000n, 92_400n, false]),
};
const redeemLog = {
  address: source, blockNumber: "0x1771", blockHash: hash17, transactionHash: txRedeem, logIndex: "0x0",
  topics: [toEventSelector("ReferralInviteRedeemed(address,address,bytes32,uint256,bool,bool,uint64)"), indexed(owner), indexed(invitee), commitment],
  data: encodeAbiParameters(parseAbiParameters("uint256,bool,bool,uint64"), [100n, true, false, 6001n]),
};
const selector = (signature) => toFunctionSelector(signature);
function sourceRead(data) {
  const key = data.slice(0, 10).toLowerCase();
  if (key === selector("owner()")) return indexed(owner);
  if (key === selector("game()")) return zero;
  if (key === selector("referralSigner()")) return indexed(signer);
  if (key === selector("referralMigrationFinalized()")
    || key === selector("referralRedemptions(bytes32,address)")
    || key === selector("referralInviteeRedeemed(address)")) return `0x${word(1)}`;
  if (key === selector("referralCommitmentOf(address)")) return commitment;
  if (key === selector("referralCodeOwner(bytes32)") || key === selector("referralInvites(bytes32)")) return indexed(owner);
  if (key === selector("referralCodeHashOf(bytes32)")) return codeHash;
  if (key === selector("referralClaimedAt(bytes32)")) return `0x${word(6000)}`;
  if (key === selector("totalReferralRewardsAccrued(address)") || key === selector("totalReferralRewardsPaid(address)")) return `0x${word(100)}`;
  if (key === selector("referralRedemptionQuota(bytes32)")) return `0x${word(2)}${word(0)}`;
  if (key === selector("referralCodeMigrationKind(bytes32)") || key === selector("referralMigrationExpectedHashOnlyHash()")
    || key === selector("referralMigrationExpectedHashOnlyCount()") || key === selector("referralMigrationImportedHashOnlyHash()")
    || key === selector("referralMigrationImportedHashOnlyCount()") || key === selector("claimableReferralRewards(address)")
    || key === selector("referralRewardCredits(bytes32,address)") || key === selector("totalReferralRewardsClaimed(address)")) return zero;
  if (key === selector("aggregate3((address,bool,bytes)[])")) {
    const decoded = decodeFunctionData({ abi: multicall3Abi, data });
    const calls = decoded.args[0];
    return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: calls.map((call) => ({ success: true, returnData: sourceRead(call.callData) })) });
  }
  throw new Error(`Unexpected selector ${key}`);
}

async function runManifest(input) {
  const directory = mkdtempSync(join(tmpdir(), "referral-verified-"));
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
            const number = first === "latest" ? 6001 : Number(BigInt(first));
            result = { number: `0x${number.toString(16)}`, hash: number === 6000 ? hash16 : hash17,
              parentHash: `0x${"11".repeat(32)}`, timestamp: `0x${number.toString(16)}`,
              gasLimit: "0x1000000", gasUsed: "0x0", baseFeePerGas: "0x1", transactions: [] };
            break;
          }
          case "eth_getCode": result = second === "0x176f" ? "0x" : "0x6000"; break;
          case "eth_getBalance": result = "0x0"; break;
          case "eth_getLogs": result = [claimLog, redeemLog]; break;
          case "eth_getTransactionReceipt": {
            const log = first === txClaim ? claimLog : first === txRedeem ? redeemLog : null;
            if (!log) throw new Error("Unexpected receipt");
            result = { transactionHash: first, status: "0x1", blockNumber: log.blockNumber, blockHash: log.blockHash,
              logs: [log], from: owner, to: source, transactionIndex: "0x0", gasUsed: "0x1", cumulativeGasUsed: "0x1" };
            break;
          }
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

const input = {
  sourceReferral: source, indexFromBlock: "6000", indexCursorBlock: "6001", snapshotBlock: "6001", snapshotBlockHash: hash17,
  claims: [{ eventName: "ReferralInviteWindowActivated", transactionHash: txClaim, blockNumber: "6000", logIndex: "0" }],
  redemptions: [{ eventName: "ReferralInviteRedeemed", transactionHash: txRedeem, blockNumber: "6001", logIndex: "0" }],
  rewardClaims: [], legacyInvites: [],
};

test("canonical receipt-backed claim/redemption yields exact replay, reward and quota manifest", async () => {
  const result = await runManifest(input);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.manifest.validCodeManifest.count, 1);
  assert.equal(result.manifest.redemptionManifest.count, 1);
  assert.equal(result.manifest.rewardStatsManifest.count, 1);
  assert.equal(result.manifest.rewardStatsManifest.rows[0].accrued, "100");
  assert.equal(result.manifest.rewardStatsManifest.rows[0].paid, "100");
  assert.deepEqual(result.manifest.calldata.redemptionPaid, [true]);
  assert.deepEqual(result.manifest.calldata.redemptionCredited, [false]);
});

test("missing indexed redemption cannot silently produce a partial manifest", async () => {
  const result = await runManifest({ ...input, redemptions: [] });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /index inventory disagrees/);
});
