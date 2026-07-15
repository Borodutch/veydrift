# Referral code ownership migration (VEY-KANEO-714)

The replacement `VeydriftReferralSystem` starts with public code claims disabled. OpenClaw's
deployment owner must migrate the legacy code inventory and explicitly finalize migration before
the game/runtime pointer is switched.

## Build the migration manifest

1. Export every legacy claimed invite from the current backend recovery store together with its
   inviter wallet and latest successful on-chain activation timestamp.
2. Normalize every code to lowercase. Reject empty values, values longer than 24 characters, and
   values outside `[A-Za-z0-9_-]`; do not silently rewrite any other character.
3. Group rows by normalized code. A code with multiple distinct wallets is a pre-upgrade collision.
   Stop the rollout and record an explicit canonical owner decision for every collision. Never let
   list order choose the owner.
4. Collapse repeated claims by the same owner/code to the latest activation timestamp. Preserve
   all distinct codes owned by a wallet; only its latest still-unexpired activation becomes the
   current window.
5. Archive the reviewed manifest and its SHA-256 hash as deployment evidence. The manifest contains
   public codes/addresses/timestamps only; it must not contain keys, tokens, or RPC credentials.

## Import and verify

Submit bounded batches through:

```text
migrateReferralCodes(address[] inviters,string[] codes,uint64[] activatedAts)
```

The contract lowercases and validates every code again. It reverts the entire batch with
`ReferralCodeAlreadyOwned(codeHash, owner)` if a normalized code is assigned to another wallet,
making an unresolved collision non-deployable.

For every manifest row, verify `referralCodeOwner(keccak256(bytes(normalizedCode)))` and the emitted
`ReferralCodeOwnershipClaimed` / `ReferralInviteWindowActivated` values. Verify each wallet's latest
activation through `referralInviteState(wallet)`. Compare imported row counts and code hashes with
the reviewed manifest before calling:

```text
finalizeReferralCodeMigration()
```

Finalization is one-way. Confirm `referralMigrationFinalized() == true`; the post-deploy smoke script
also enforces this gate and `REFERRAL_CODE_MAX_LENGTH() == 24`.

## Rollout order and rollback

1. Deploy and wire the new referral system, but do not point production traffic at it.
2. Import, collision-audit, verify, and finalize the legacy ownership manifest.
3. Upgrade the game settlement module to the new referral address and verify proxy/module wiring,
   game owner, start price, and resource invariants.
4. Point the backend at the new referral address, rebuild from its deployment block, and verify
   indexed ownership/window/quota state against contract views.
5. Deploy the frontend and run `scripts/veydrift-postdeploy-smoke.mjs` before bounded Mimo QA.

If any pre-switch verification fails, keep the existing game module/referral address and discard the
unreferenced replacement deployment. After the game pointer changes, rollback uses the previous
first-planet settlement module/referral address through the normal `UpgradeGame.s.sol` owner path;
do not mutate backend/frontend runtime pointers until that rollback is verified.
