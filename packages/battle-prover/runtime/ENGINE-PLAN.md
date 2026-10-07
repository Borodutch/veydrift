# Runtime execution interface plan — next source version

Historical proof source 4a2b2e79503d876ae096daac493566790c4f993a and runtime increment 925db95170c2ed89121fa6116da352b5a6949ebb remain immutable historical evidence. New production constructors and engine receive a new source identity; no old source maps/approvals will be rewritten.

## Agreed local interfaces being implemented

1. composition.NewLeafWitness(frontend.Circuit) wraps typed native Step assignments into the existing FamilyLeaf relation with exact normalized range/public values. Bare Close rejected. NewCloseWitness binds the actual bridge Close to a verified attribution root. NewNodeWitness constructs existing fixed-family unary/binary relations against approved catalog keys. No reflection, fixture or test helpers.
2. Native trace driver consumes authoritative service.Snapshot + separately approved chainsource.Release, emits deterministic typed events for all phases/groups, and exposes full final manifest/leaves. Native restart is bounded replay checked against exact cursor/endpoints, never acceptance of unproved cursor advice.
3. Frontier consumes verified leaf receipts and advances at most one approved proof operation at a time. Canonical durable serialization binds identity, anchor, catalog, phase/group, ordered work and every pending/frontier receipt. Restore cryptographically verifies all retained receipts against independently approved keys and exact public ranges.
4. Engine orchestrates real witness events, approved proving operations, dependency roots/adapters, checkpoints and final artifact construction. No Go-test proxy. Proving stage completion is distinct from complete-battle result.

## Process boundary coordination request (no processrunner edits yet)

Existing processrunner has fixed stdin {Protocol,Identity,Attempt,ManifestSHA256,Input,Checkpoint}, strips environment, and demands final result on exit. Proposed minimal extension: explicit typed stage-complete message/result distinct from final; it carries only a durable checkpoint, never marks a service job complete. Approved catalog locator/config must be pinned through a separately reviewed immutable engine configuration identity, not a job-selected path. Prefer passing trusted configuration via an inherited read-only descriptor hashed by process manifest, rather than inheriting arbitrary environment. Parent approval/design coordination is required before changing processrunner. Current engine logic can be exercised as a library while this boundary is agreed.

service/ checkpoint cancellation is separately owned by native86b63; no edits from this worker.

## Key chronology and cycle analysis BEFORE new heavy proving

- Fix relation source/schema/protocol constants and target root heights first, independently of every battle input.
- Build/setup leaf catalogs (attribution first), D0, then B_h followed by D_h through selected heights. CompleteClose depends on the prebuilt attribution terminal VK. Build phase joins, pipeline, raw-qualified, output-pipeline, final in topological order.
- Final VK is available before exporting Solidity verifier and obtaining its deployed runtime codehash/address. The chain registry/release configuration is then frozen before any job is admitted.
- Game, verifier address, verifier codehash, battle, randomness and chain record are WITNESS values in the current LinkedCircuit/settlement relation, not compiled constants. Inspect qualification/linked.go: only rules/catalog/seed policy/version are fixed protocol constants. Therefore final VK need not depend on its own address/codehash. No actual cryptographic key cycle is present in the inspected dependency DAG. Do not add final deployment metadata into an ancestor key identity, which would create an avoidable manifest cycle.
- Runtime validates the authoritative job against the already-approved deployment release and key catalog. Game=1/verifier=7/codehash=77 historical fixture is never translated into production acceptance evidence.

## Public PK storage versus setup secrets

Groth16 proving keys are PUBLIC proving artifacts, distinct from secret ceremony randomness/toxic waste. A reviewed ceremony can persist canonical CCS/PK/VK bytes in an immutable read-only content-addressed store, with exact lengths/SHA256, relation source/schema hashes, dependency VK pins, ceremony/transcript provenance and separately approved catalog root. Runtime Catalog.Load consumes those approved public PK bytes and never calls Setup. Secret contributions/randomness must not enter this store. Existing development Setup outputs are neither automatically persisted nor promoted.

No new heavy proving, development PK persistence or ceremony has been started. Before any such run: agree fresh development-only artifact namespace and approved persistence/provenance plan, prebuild the whole required fixed dependency DAG/final VK, then create identity-correct frozen jobs. Two distinct jobs must reuse that same catalog/final VK. Routine work remains 2CPU/soft2GiB; any separately coordinated proof remains <=4M and <=60min/stage with soft6GiB.

## Concrete builder and next validation boundary

BuildCatalogTemplate now constructs actual roster-independent circuit shapes for every BuildCatalogGraph node from ordered prior public CCS/VK dependencies. This is not Setup: external ceremony tooling supplies independently reviewed PK/VK artifacts, and a manifest approval is not derived from a candidate receipt. The full all-height256 graph contains 3,634 circuit nodes (36 leaves + 7 D0 + 3,584 B/D nodes + 7 adapters). The finite fixture-height graph has 99 family keys plus 7 adapters. Neither storage size nor ceremony/proving duration for the full graph has been measured; do not silently label the 106-key finite graph D256.

Proposed next **separately coordinated development validation**, not executed:
1. Select a new development-only namespace and source revision; independently review which finite root heights cover two chosen jobs. Explicitly authorize canonical public CCS/PK/VK persistence there, with no toxic randomness/transcript secret retention.
2. Use BuildCatalogTemplate in topological order before either job exists, enforce every <=4M circuit and <=60min setup/proof stage, and retain exact source/schema/dependency VK/hash metadata. Any oversized or failed stage stops without overwriting old output or raising limits.
3. Freeze the resulting catalog root and final VK, export/deploy its verifier into an isolated local contract harness, record actual deployed codehash/address, then freeze two different jobs under that release. This ordering avoids deriving identity from the old proof fixture.
4. Source each job through authoritative event/storage documents; use the actual runtime executable, approved immutable keys, staged process checkpoints and deliberate restart. Require the same catalog/final VK for both jobs, final native verification, authentic allocation suffix and actual contract acceptance.
5. Report setup, fresh proof, restart, EVM and native evidence separately. A local development approval does not authorize production activation; D256 catalog generation/approval remains a separately measurable scope.

This plan does not initiate key generation, filesystem artifact writes outside task docs, local-chain transactions or production deployment. Parent must coordinate that next execution scope and budgets. Current routine tests use preserved public receipts only.
