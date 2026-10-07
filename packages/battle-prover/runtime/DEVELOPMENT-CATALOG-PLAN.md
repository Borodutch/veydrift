# Development catalog engineering gate (2026-10-06)

Parent authorizes implementation/preflight, not heavy setup yet. Preserved engine handoff commit: 3eadb4d3027e8ceb5e6f5788c6b4d4432350c043. Independent parent review 82164 and builder review must clear before source freeze or setup. This is an internal engineering gate, not a user approval blocker.

## Finite capability proposal

Root heights in runtime phase order [Preparation, Combat, Attribution, Bridge, Report, RawJournal, SettlementOutput]: **[5,8,2,4,5,3,4]**. Capacity respectively **[32,256,4 per attribution group,16,32,8,16]** elementary events. Graph has **112 keys**: 36 leaves + 7 D0 + 62 B/D + 7 adapters. All leaf kinds remain included; keys are not selected from a particular job's actual instructions.

Native-only TestDevelopmentFiniteCapacity measures two distinct small candidate capabilities (2 or 3 rows, one unit per row, both sides, separate owner technology). PASS 3.477s under 2CPU/soft2GiB. Counts:

|phase|2 rows|3 rows|
|---|---:|---:|
|Preparation|10|17|
|Combat|128|197|
|Attribution per group|4 (2 groups)|4 (3 groups)|
|Bridge total, including Close|9|13|
|Report|12|18|
|Raw journal|5|7|
|Output|8|11|

These are capability exploration documents, NOT frozen jobs or chain identities. Initial historical-height probe correctly rejected combat/report overflow; selected heights now reflect actual native events. Local contract owner may use faster single-round configurations within the same envelope. Actual deployed randomness/identity can alter combat; preflight each sourced job against all capacities before proving, reject overflow rather than extending keys or truncating work. Graph/key build must precede deployment/frozen jobs. This finite graph makes no D256 or large-roster claim.

## Store/budget and cost uncertainty

Only /Users/borodutch/.openclaw/workspace/artifacts/ticket44/dev-catalog-20261006-v2 may persist PUBLIC CCS/PK/VK plus manifests; never private witnesses, toxic randomness, secrets, old namespace modifications or git large keys. Explicit total namespace budget <=100GiB including temporary files; >=100GiB free floor; each artifact <=8GiB. Live available disk 588428244 KiB (~561.17GiB). Reserve transient space before writes and enforce streaming limits; immutable no-overwrite stage commit, exact canonical hashes, fsync and fail-closed restart/dependency checking. One global heavy-process lock, one killable stage, max4M constraints, max60min, 2CPU/soft6GiB. Soft memory is not a hard RSS qualification.

Storage is not yet measured: compressed PK comprises roughly 32*(A+B+Z+K) +64*B2 points plus domain/commitment metadata; at millions of constraints a key can be hundreds of MiB. A preliminary 0.75GiB-per-node estimate would total84GiB for112 nodes. The implemented conservative preflight reserves24GiB+16MiB (three maximum8GiB files) before EACH stage, so84GiB does NOT currently fit the100GiB budget through graph completion. Committed data before the last stage must remain below roughly76GiB; average sustained node size must therefore stay below roughly0.68GiB. First-stage measurements must resolve this; do not weaken reservation or increase budget to make the graph pass. This is an envelope, NOT a proved upper bound or permission to start the graph. CCS density/wire count and FFT sizes matter; actual whole graph may exceed this. First approved bounded stage must report constraints/wires/CCS-PK-VK lengths/setup wall/RSS, extrapolated per-kind costs and remaining disk before any wholegraph authorization. One small leaf alone cannot establish recursive-key cost; record that uncertainty and refine after first approved recursive stage. Stop if projection cannot fit; do not raise disk/constraint/time budgets.

## Implementation owners / integration

- Builder: child3dfa761b, new devcatalog/ package + CLI, no runtime Setup dependency. Plan/preflight default, explicit single-stage execution, separately pinned external development approval after candidate manifests; no self-promotion.
- Verified 384-byte EVM export: child4c59ecc4, new runtime/evm_export files. Calls full ArtifactVerifier first; MarshalSolidity commitment-aware exact384B, retains22 public limbs/authenticated leaves. Compressed artifact transport unchanged. Contract owner must consume this output with the matching final VK Solidity verifier; no discarded commitments/PoK.
- Contract owner (parent assigned): local deployment, actual verifier address/codehash, authority source staging and positive contract acceptance for two jobs sharing catalog/VK.

Source hashes are intentionally NOT frozen before builder and export review. Freeze must enumerate exact non-test relation/runtime/builder sources and go.mod/go.sum, hash each and the canonical manifest; record compiler/gnark versions, finite graph digest, node schema, dependency VK pins and separate provenance/review approval. Parent preserved commit is a baseline, not the final builder source hash.

Next checkpoint: implementation/tests + independent review -> exact source hashes and reviewed plan -> parent first-stage authorization -> measured first-stage report -> explicit remaining graph gate. No setup/key persistence started here.
