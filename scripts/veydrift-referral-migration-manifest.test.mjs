import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { toFunctionSelector } from "viem";
import {
  assertIndexedRefs,
  normalizeCode,
  redemptionLeaf,
  rewardClaimLeaf,
  rewardStatsLeaf,
} from "./veydrift-referral-migration-manifest.mjs";

const tx = `0x${"12".repeat(32)}`;
const owner = "0x1111111111111111111111111111111111111111";
const invitee = "0x2222222222222222222222222222222222222222";
const commitment = `0x${"34".repeat(32)}`;

test("requires canonical source event inventory rather than trusting a partial backend index", () => {
  const canonical = [{ eventName: "ReferralInviteRedeemed", transactionHash: tx, logIndex: "0x0" }];
  assert.throws(() => assertIndexedRefs([], canonical, "ReferralInviteRedeemed"), /disagrees/);
  assertIndexedRefs([{ ...canonical[0], logIndex: "0" }], canonical, "ReferralInviteRedeemed");
  assert.throws(() => assertIndexedRefs([...canonical, ...canonical], canonical, "ReferralInviteRedeemed"), /disagrees/);
});

test("offline frozen empty-source manifest commits all five classes without signing or broadcast", async () => {
  const directory = mkdtempSync(join(tmpdir(), "referral-manifest-"));
  const ownerAddress = "0x1111111111111111111111111111111111111111";
  const signerAddress = "0x2222222222222222222222222222222222222222";
  const blockHash = `0x${"33".repeat(32)}`;
  const pad = (hex) => `0x${hex.replace(/^0x/, "").padStart(64, "0")}`;
  const responseFor = (request) => {
    if (request.method === "eth_getBlockByNumber") return {
      number: "0x10", hash: blockHash, parentHash: `0x${"44".repeat(32)}`, timestamp: "0x10",
      gasLimit: "0x1000000", gasUsed: "0x0", baseFeePerGas: "0x1", transactions: [],
    };
    if (request.method === "eth_getCode") return request.params[1] === "0xf" ? "0x" : "0x6000";
    if (request.method === "eth_getBalance") return "0x0";
    if (request.method === "eth_getLogs") return [];
    if (request.method === "eth_chainId") return "0x2105";
    if (request.method === "eth_call") {
      const selector = request.params[0].data.slice(0, 10);
      if (selector === toFunctionSelector("owner()")) return pad(ownerAddress);
      if (selector === toFunctionSelector("game()")) return pad("0x0");
      if (selector === toFunctionSelector("referralSigner()")) return pad(signerAddress);
      if (selector === toFunctionSelector("referralMigrationFinalized()")) return pad("0x1");
      return pad("0x0");
    }
    throw new Error(`Unexpected RPC method ${request.method}`);
  };
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const result = (item) => ({ id: item.id, jsonrpc: "2.0", result: responseFor(item) });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(Array.isArray(input) ? input.map(result) : result(input)));
    } catch (error) {
      response.statusCode = 500;
      response.end(String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const inputPath = join(directory, "input.json");
  const outPath = join(directory, "manifest.json");
  writeFileSync(inputPath, JSON.stringify({
    sourceReferral: "0x3333333333333333333333333333333333333333",
    indexFromBlock: "16", indexCursorBlock: "16", snapshotBlock: "16", snapshotBlockHash: blockHash,
    claims: [], redemptions: [], rewardClaims: [], legacyInvites: [],
  }));
  try {
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, [new URL("./veydrift-referral-migration-manifest.mjs", import.meta.url).pathname,
        "--rpc-url", `http://127.0.0.1:${address.port}`, "--input", inputPath, "--out", outPath],
      { env: { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" } });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (code) => resolve({ code, stderr }));
    });
    assert.equal(result.code, 0, result.stderr);
    const manifest = JSON.parse(readFileSync(outPath, "utf8"));
    assert.equal(manifest.version, 2);
    assert.equal(statSync(outPath).mode & 0o777, 0o600);
    for (const key of ["validCodeManifest", "hashOnlyManifest", "redemptionManifest", "rewardClaimManifest", "rewardStatsManifest"]) {
      assert.equal(manifest[key].count, 0);
      assert.equal(manifest[key].digest, `0x${"0".repeat(64)}`);
    }
    assert.equal(manifest.sourceGame, "0x0000000000000000000000000000000000000000");
  } finally { server.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("receipt-backed migration commitments bind reward amounts, recipient, and historical counters", () => {
  const row = { inviter: owner, invitee, commitment, redeemedAt: "42", rewardAmount: "100", paid: true, credited: false };
  assert.notEqual(redemptionLeaf(row), redemptionLeaf({ ...row, paid: false, credited: true }));
  assert.notEqual(redemptionLeaf(row), redemptionLeaf({ ...row, rewardAmount: "101" }));
  const claim = { inviter: owner, invitee, commitment, recipient: owner, amount: "100", claimedAt: "43" };
  assert.notEqual(rewardClaimLeaf(claim), rewardClaimLeaf({ ...claim, recipient: invitee }));
  assert.notEqual(rewardStatsLeaf({ inviter: owner, accrued: 100n, paid: 100n, claimed: 0n }),
    rewardStatsLeaf({ inviter: owner, accrued: 100n, paid: 100n, claimed: 100n }));
  assert.equal(normalizeCode("My_Code-1"), "my_code-1");
  assert.throws(() => normalizeCode("invalid code"), /invalid characters/);
});
