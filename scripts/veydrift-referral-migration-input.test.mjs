import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, stringToHex } from "viem";

import { buildReferralMigrationInput } from "./veydrift-referral-migration-input.mjs";
import { referralAbi } from "./veydrift-referral-migration-manifest.mjs";

const source = "0x3333333333333333333333333333333333333333";
const owner = "0x1111111111111111111111111111111111111111";
const invitee = "0x4444444444444444444444444444444444444444";
const legacyCode = "Abcdefghijklmnopqrstuvwxyz0123456789_-abcd0";
const legacyCommitment = keccak256(stringToHex(legacyCode));
const commitment = `0x${"12".repeat(32)}`;
const hash = (n) => `0x${n.toString(16).padStart(64, "0")}`;

function log(block, logIndex, eventName, args, data) {
  return {
    address: source, blockNumber: BigInt(block), logIndex, transactionHash: hash(block),
    topics: encodeEventTopics({ abi: referralAbi, eventName, args }), data
  };
}

const logs = [
  log(10, 0, "ReferralLegacyCodeOwnershipImported",
    { owner, codeHash: keccak256(stringToHex(legacyCode.toLowerCase())), legacyCommitment }, hash(7)),
  log(11, 3, "ReferralInviteWindowActivated", { inviter: owner, codeHash: hash(5), commitment },
    encodeAbiParameters([{ type: "string" }, { type: "uint64" }, { type: "uint64" }, { type: "bool" }], ["code", 1n, 2n, false])),
  log(12, 1, "ReferralInviteRedeemed", { inviter: owner, invitee, commitment },
    encodeAbiParameters([{ type: "uint256" }, { type: "bool" }, { type: "bool" }, { type: "uint64" }], [0n, false, false, 3n])),
];

function client({ to = source, input } = {}) {
  return {
    async getBlock({ blockNumber }) { return { hash: hash(1000n + blockNumber) }; },
    async getLogs({ fromBlock, toBlock }) {
      return logs.filter((item) => item.blockNumber >= fromBlock && item.blockNumber <= toBlock);
    },
    async getTransaction() {
      return { to, input: input ?? encodeFunctionData({ abi: referralAbi, functionName: "migrateLegacyReferralCodeOwnership",
        args: [[owner], [legacyCode], [legacyCommitment]] }) };
    }
  };
}

test("builds generator input refs and recovers hash-only preimages from source import calldata", async () => {
  const first = await buildReferralMigrationInput({ client: client(), sourceReferral: source, indexFromBlock: 9n, snapshotBlock: 11n, chunkSize: 2n });
  assert.deepEqual(first.legacyInvites, [{ owner, code: legacyCode, commitment: legacyCommitment, importTxHash: hash(10) }]);
  assert.deepEqual(first.claims, [{ eventName: "ReferralInviteWindowActivated", transactionHash: hash(11), blockNumber: "11", logIndex: "3" }]);
  assert.equal(first.indexCursorBlock, "11");
  assert.equal(first.snapshotBlockHash, hash(1011));

  // Resuming after the freeze rescans only the new blocks and keeps the earlier inventory.
  const resumed = await buildReferralMigrationInput({ client: client(), sourceReferral: source, indexFromBlock: 9n, snapshotBlock: 12n, previous: first });
  assert.equal(resumed.claims.length, 1);
  assert.deepEqual(resumed.redemptions.map((ref) => ref.transactionHash), [hash(12)]);
  assert.equal(resumed.legacyInvites.length, 1);
  await assert.rejects(buildReferralMigrationInput({ client: client(), sourceReferral: source, indexFromBlock: 9n, snapshotBlock: 12n,
    previous: { ...first, snapshotBlockHash: hash(1) } }), /no longer canonical/);
});

test("fails closed when a hash-only preimage is not in a direct source import call", async () => {
  await assert.rejects(buildReferralMigrationInput({ client: client({ to: owner }), sourceReferral: source, indexFromBlock: 9n, snapshotBlock: 10n }),
    /not a direct source import call/);
  const wrongCode = encodeFunctionData({ abi: referralAbi, functionName: "migrateLegacyReferralCodeOwnership",
    args: [[owner], [legacyCode.toLowerCase()], [legacyCommitment]] });
  await assert.rejects(buildReferralMigrationInput({ client: client({ input: wrongCode }), sourceReferral: source, indexFromBlock: 9n, snapshotBlock: 10n }),
    /no calldata preimage/);
});
