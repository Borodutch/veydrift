# Referral code ownership migration (VEY-KANEO-714)

The replacement `VeydriftReferralSystem` starts with public code claims disabled. OpenClaw's
deployment owner must migrate the legacy code inventory and explicitly finalize migration before
the game/runtime pointer is switched.

## Build the migration manifest

1. Use the backend recovery store only as a candidate transaction/code inventory. For every row
   with a transaction hash, fetch the receipt, require status `1`, and decode the historical claim
   event from the emitting legacy referral contract. Derive the owner, code hash/commitment, and
   activation block timestamp from that receipt/event. JSON timestamps and owners are not
   authoritative.
2. Exclude rows without a successful receipt or matching decoded claim event. The reviewed
   production inventory is **6** confirmed valid codes, **10** confirmed 43-character legacy
   codes, and **3** JSON-only rows with no transaction hash. The three JSON-only rows are not
   migration entries.
3. Reconstruct the historical commitment as `keccak256(originalCaseSensitiveCodeBytes)` and require
   it to match the decoded event exactly. Legacy claim events did not bind the inviter into this
   value. Separately normalize the code to lowercase and derive the canonical
   ownership hash. Values in `[A-Za-z0-9_-]` with 1–24 characters are valid-code entries. The ten
   successfully claimed 43-character values are hash-only entries; invalid characters, other
   overlength sizes, or any receipt/owner/code/commitment mismatch stop the rollout.
4. Group rows by normalized code hash. A hash with multiple distinct wallets is a pre-upgrade
   collision. Stop the rollout and record an explicit canonical owner decision for every collision.
   Never let list order choose the owner.
5. Collapse repeated claims by the same owner/code to the latest authoritative activation
   timestamp. Preserve all distinct codes owned by a wallet; only its latest still-unexpired
   activation becomes the current window.
6. Archive the reviewed manifest, receipt/event evidence, and its SHA-256 hash as deployment
   evidence. The manifest contains public codes/addresses/timestamps only; it must not contain keys,
   tokens, or RPC credentials.

The reviewed production candidate store has SHA-256
`6f9bf13100880ce5c2d5c3e5938cbb68bc94bbd4c2fae12f424f59aa932796ee`. The historical emitting
contracts are `0xef6ff0add565c94fd96395f7be62f0773d9044fe`,
`0xdf50d108e83f14cde44ebd65d0f11bbed7fbb7e8`,
`0xdc302bc6d73ba5c849fa0f0fd99e0b2ec0ef1605`, and
`0x2c75d7263fffc2ebf87995861819becbda3a6095` on Base mainnet (chain id `8453`).

## Commit the reviewed manifest on chain

Each unique row contributes one domain-separated leaf. The valid leaf is:

```text
keccak256(abi.encode(uint8(1), owner, normalizedCodeHash, legacyCommitment, activatedAt))
```

The hash-only leaf is:

```text
keccak256(abi.encode(uint8(2), owner, legacyCodeHash, legacyCommitment))
```

XOR the unique leaves within each class. XOR is intentional so bounded batches can arrive in any
order; the contract separately rejects a second import of the same code hash and enforces the exact
reviewed count. Before importing any row, commit both reviewed count/digest pairs exactly once:

```text
configureReferralCodeMigration(validDigest, 6, hashOnlyDigest, 10)
```

Configuration rejects zero/non-zero digest/count mismatches and cannot be replaced. A wrong owner,
code hash, commitment, timestamp, missing row, duplicate row, or extra row leaves the imported
count/digest pair unequal to the reviewed pair, so finalization fails closed.

For every replacement after referrals have gone live, build a third receipt/event-backed manifest
from every successful `ReferralInviteRedeemed` emitted by the current canonical referral contract.
Do not use backend JSON alone. Require the exact emitting address, a status-1 receipt, and decoded
`inviter`, `invitee`, `commitment`, and `redeemedAt` values. The redemption leaf is:

```text
keccak256(abi.encode(uint8(3), inviter, invitee, commitment, redeemedAt))
```

XOR all unique redemption leaves and explicitly commit the count/digest pair, including an explicit
zero/zero configuration when the source contract has no redemptions:

```text
configureReferralRedemptionMigration(redemptionDigest, redemptionCount)
```

Before importing, audit every source redemption's `paid` / `credited` event values and the source
contract's balance, `claimableReferralRewards`, and per-redemption credit state. The current replay
migration preserves eligibility and quota state, not escrowed ETH or credit accounting. If any
outstanding credit or unexplained contract balance exists, stop the rollout and add a separately
audited credit migration; never strand funds by switching the game/runtime pointer.

## Import and verify

Submit bounded valid-code batches, passing each decoded legacy commitment as the fourth array:

```text
migrateReferralCodes(
  address[] inviters,
  string[] codes,
  uint64[] activatedAts,
  bytes32[] legacyCommitments
)
```

The contract lowercases and validates every valid code again, requires `legacyCommitment ==
keccak256(originalCaseSensitiveCodeBytes)`, and reverts the entire batch with
`ReferralCodeAlreadyOwned(codeHash, owner)` if a normalized code is assigned to another wallet.
The committed manifest leaf binds that receipt-proven value to the reviewed owner, normalized code
hash, and activation timestamp. Altering an owner or timestamp changes the imported digest and makes
finalization revert. That makes an unresolved collision or altered receipt row non-deployable. The
new active invite commitment is still derived separately as
`keccak256(abi.encode(inviter, normalizedCodeHash))`; public claim and redemption binding never use
the legacy raw-hash rule.

Import only the ten confirmed overlength claims through the separate hash-only path:

```text
migrateLegacyReferralCodeOwnership(
  address[] inviters,
  string[] legacyCodes,
  bytes32[] legacyCommitments
)
```

This path accepts only the reviewed 43-character URL-safe shape, verifies the historical commitment
as the raw `keccak256` of the original case-sensitive bytes, permanently sets ownership of the
canonical lowercase hash, and emits `ReferralLegacyCodeOwnershipImported`. It does not create a new
commitment, invite record, activation timestamp, active window, or redemption surface. The normal
public validator remains 1–24 characters, and hash-only migration entries are also explicitly barred
from public activation. Never pass an unconfirmed JSON-only row to either import function.

After all valid code activations have been imported, import the audited redemption rows in bounded
batches:

```text
migrateReferralRedemptions(
  address[] inviters,
  address[] invitees,
  bytes32[] commitments,
  uint64[] redeemedAts
)
```

Each row must reference an already imported canonical commitment and matching inviter, contain a
nonzero invitee and nonfuture timestamp, and be unique globally and for that commitment. Import sets
both `referralInviteeRedeemed(invitee)` and `referralRedemptions(commitment, invitee)` so a wallet
cannot receive a second referral after replacement. A timestamp consumes quota only when it belongs
to the commitment's latest imported activation interval and is still inside its rolling 24-hour
window at import time. Older rows still preserve replay protection but do not consume a renewed
activation's fresh quota. More than three live timestamps for one commitment fail closed.

For every manifest row, verify `referralCodeOwner(codeHash)` and
`referralCodeMigrationKind(codeHash)`. For each valid-code row, verify the emitted
`ReferralCodeOwnershipClaimed` / `ReferralInviteWindowActivated` values and the wallet's latest
activation through `referralInviteState(wallet)`. For every hash-only row, verify the dedicated
`ReferralLegacyCodeOwnershipImported` event and confirm `referralCommitmentOf(owner)`,
`referralClaimedAt(commitment)`, and `referralInvites(commitment)` were not populated by that row.
Compare all four expected/imported count/digest getters before calling:

```text
finalizeReferralCodeMigration()
```

Also compare `referralMigrationExpectedRedemptionHash/Count` with
`referralMigrationImportedRedemptionHash/Count`, verify every imported invitee through both replay
getters, and compare each active commitment's `referralRedemptionQuota` with the source contract.
Finalization requires an explicit redemption migration configuration and exact redemption
count/digest equality in addition to the valid and hash-only code manifests.

Finalization is one-way and contract-enforced: it reverts unless all three configured count/digest
pairs exactly match their imports. The original reviewed deployment used 6 valid and 10 hash-only
rows; later replacements must use the complete current receipt-backed inventory, including new
public claims and redemptions. Confirm `referralMigrationFinalized() == true`; the post-deploy smoke
script also enforces this gate and `REFERRAL_CODE_MAX_LENGTH() == 24`.

## Rollout order and rollback

1. Deploy and wire the new referral system, but do not point production traffic at it.
2. Import and collision-audit the ownership manifest; import every audited redemption replay row;
   verify code, invitee, active-quota, and zero-outstanding-credit state; then finalize.
3. Upgrade the game settlement module to the new referral address and verify proxy/module wiring,
   game owner, start price, and resource invariants.
4. Point the backend at the new referral address, rebuild from its deployment block, and verify
   indexed ownership/window/quota state against contract views.
5. Deploy the frontend and run `scripts/veydrift-postdeploy-smoke.mjs` before bounded Mimo QA.

For step 4, set `VEYDRIFT_REFERRAL_INDEX_FROM_BLOCK` on the Easypanel-managed backend service to the
replacement referral deployment block (or another reviewed safe boundary at or before its first
canonical event). For the reviewed Base-mainnet migration, block `48689448` is an inclusive safe
boundary because it contains the canonical migration batch. On the writer's first successful poll,
the backend scans only the configured referral address and only `ReferralInviteWindowActivated`,
`ReferralInviteRedeemed`, and `ReferralRewardClaimed` topics through the current head. It persists an
address/boundary completion marker after every log is applied; the marker makes restarts cheap, while
an address or boundary change deliberately reruns the idempotent scan. Inspect
`chainSync.referralHistoryBackfill` on `/health` for the completed range or a readiness-blocking error.
Do not delete or rebuild the shared index database for this repair.

If any pre-switch verification fails, keep the existing game module/referral address and discard the
unreferenced replacement deployment. After the game pointer changes, rollback uses the previous
first-planet settlement module/referral address through the normal `UpgradeGame.s.sol` owner path;
do not mutate backend/frontend runtime pointers until that rollback is verified.
