# Controlled legacy mission nonce recovery

This explicit command supports exactly one legacy planet-to-planet Transport return with zero remaining cargo, preserving the full original one-member batch. Multi-member/arrival/moon/cargo-bearing recovery is explicitly rejected rather than generalized without proof. It adds at most one alternative. It never allocates a fresh nonce, repacks members, deletes the original, cancels with a self-transfer, or increases the immutable 0.0002 ETH transaction ceiling.

## Reviewed input and invocation

The operator CLI accepts only the byte-for-byte independently reviewed [#58 manifest](./recovery-58-input.json), SHA256 `bf984f3a4bafd23b5529d84e8b1c9d11178a4701a78cd3223ebc0792a1d4a45c`, compiled into this release. All 15 identities, assets, provenance and policies are pinned by that digest; there is no force/digest override flag. Any byte change requires a newly reviewed source release. Unknown fields at every manifest object and member are rejected. The internal typed helpers permit synthetic fixtures but are not alternative operator entry points.

The pinned private operator JSON implements `MissionRecoveryInput` in `apps/backend/src/missionLegacyRecovery.ts`. Independently pin chain ID, public resolver address, nonce, original hash, operation ID, exact serialized ordered journal membership, game proxy, calldata hash, implementation address and runtime code hashes of implementation, modules and transitively linked libraries. Also pin a stable recoveryId, maxFeeWei at or below 200000000000000, a credential-free independent HTTPS referenceRpcUrl, mission owner/origin/target/returnAt, two packed ship storage words and zero body flags. Include public prepared-log provenance (source identifier and digest), original gas, maximum total exposure, reserved L1/operator costs, derived original maximum fee and `priority: null`. Exact arithmetic is checked; log provenance is not cryptographic reconstruction of the old signature. Supply a freshly reviewed fixed gas limit and `allowAlreadySettled: false`, unless the exact-intent no-op branch was reviewed.

Unknown original priority is bounded by the original maximum fee. Both alternative fee bounds use ceil(125% × original max fee), refreshed against current Base fees. The historical #58 gas=1000000 / priority=23995423 observation is not a reusable quote. Current exact-envelope simulation, Base nonexecution fees, balance, code identity and block freshness must pass at one pinned block. After candidate/nonce reads, the code rechecks that block’s identity/assets/reference and requires the local latest head still match; a moved head restarts the complete proof instead of combining snapshots. This conservative requirement may defer a send if RPC latency spans a block; neither the 128-read/5s reconciliation bound nor caps are raised. The synchronous freshness guard executes before the irreversible signing reservation and directly before dispatch; known pre-sign expiry leaves a resumable claim, while a genuinely unknown signing result stays fenced.

From `apps/backend`, inside the managed environment using its existing approved configured signer and persistent journal:

```sh
bun src/missionLegacyRecoveryCli.ts --input /private/recovery-58.json
bun src/missionLegacyRecoveryCli.ts --input /private/recovery-58.json --broadcast
```

Default mode opens SQLite read-only: no coordinator construction/migration, lease, signing or journal mutation. It checks the original binding and envelope preflight, not exclusive ownership or execution. Broadcast mode rechecks under the shared lease. It never prints keys, raw bytes or caught RPC errors. Reuse the exact input on restart; changed serialized evidence is rejected. Pending/provisional is not completion. Backend ticks reconcile after candidate transfer; pre-transfer states require repeating this command.

## Release checkpoint and observation

1. Exact-head independent review, green tests/CI and managed stop-first compatible deployment are required. Inventory every mission/randomness/moon writer and verify the same shared journal. No overlapping old coordinator.
2. Before signing checkpoint release SHA, input digest, public writer identities and consistent SQLite backup manifest. Use SQLite backup API or stopped/checkpointed verified backup, never copy the main DB alone over WAL. Protect DB/WAL/backups containing broadcast-capable bytes; do not attach them to reports.
3. Refresh independent-reference canonical block/nonce/deployment identity and mission assets/chronology. The CLI corroborates chain, canonical block, nonce and winner finality against referenceRpcUrl. The release owner must verify this is independent infrastructure, not the same RPC route, and inspect the fresh prestate.
4. Dry-run then authorized broadcast. Own a bounded terminal observer. Unknown consumed nonce needs exact canonical hash identification; null lookups, underpriced/already-known and three failures never prove absence.
5. Check both candidates, canonical full transaction and receipt, per-member outcomes and finality. Success may contain Progress/partial failures. Verify unique return event, ships/cargo/active-count accounting and normal nonce admissions/backlog drainage. Same-nonce exclusion releases only after explicit finality.

## Durable state and rollback

Unique nonce groups retain immutable input, original, one alternative, reservation and append-only observations. Signing results persist before transfer; restart reuses bytes without re-signing. Missing result is a safety blocker. Claim without reservation may retry fresh preflight. Original inclusion stops alternative dispatch even after signing. Loser never receives winner receipt. Provisional reorg invalidates active projection, preserving observations; finalized contradiction fails closed. Reverted canonical winner consumes nonce; later ordinary domain work waits for finality. Existing send-fence/foreign-orphan rules remain.

After signing there is no undo. Rollback means hold managed writers/sends, preserve all candidates/reservations/raw/history and reconcile with compatible code. Never restore an older DB over evidence, delete lineage, or downgrade to PR1902-only code, which cannot reconcile competing hashes. Foreign namespace or unknown transport ownership cannot be cleared by expiry.
