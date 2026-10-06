# Reviewed development builder/export handoff

## Review and verification

Independent Astra review1971be21-3b0d-4493-9087-5569934223d2 (session325b6aac) found **no concrete P1/P2 code blocker for the first bounded development stage**. This is NOT Setup authorization, production approval, or clearance of parent engine review82164.

Integrated runtime PASS60.236s, builder PASS1.050s, service CLI PASS0.719s; vet PASS; builder race PASS1.677s. Independent builder PASS0.426s and runtime export/capacity selection PASS3.402s. Post-review test-only additions: missing phases/terminal trace required; actual tiny gnark CCS and preserved pinned VK decode roundtrips PASS(builder0.726s, runtime3.026s). No Setup or new key generated; tiny CCS is compiler test data in temporary test storage, historical VK copied read-only as test data. Remaining test gap: no end-to-end supervisor-death/watchdog/retained-lock harness. Same-process lock/publish tests and code review cover those paths only; no executed crash-isolation claim.

## Exact source snapshot (no production activation)

Canonical documents in runtime/development-freeze/:

- source.json SHA256 b8df19146f8e77ab2b4446841b26ede520648ce0a35f92011afdf235b0ef603d
- schema.json SHA256 6ffd4d9ed77d0efeb7d2edd9a3e583fb628e0e4f92ddea4d6d7804253b11ccc4
- provenance-plan.json SHA256 a46c36eacb6ca00bad07036cbe472724efa169aab4285e5a58f755194b41920a
- Builder SHA256 7171c928ce2fc3af8db4af3597e08803e301d0d8c3a5e0d8583973d65b9ed9bd
- Builder path /private/tmp/ticket44-builder-reviewed-20261006-325b6aac/catalog-builder
- Rules commitment 8288e8c9e9111765f370243e54088da554cccce0077763fd221ffac587eff157

85 exact local non-test Go/module files, including per-package platform alternatives, close over builder + runtime engine/service. External module versions pinned by go.mod/go.sum. Go1.27.0 darwin/arm64, CGO0 -trimpath -buildvcs=false. Two independent local build invocations produced byte-identical executable; all85 source entries rehashed unchanged afterward. This is local reproducibility, not independent toolchain/ceremony attestation. Parent must compare against any later engine review changes and invalidate/rebuild snapshot if source changes. Review/test code and docs are not circuit source inputs. Baseline3eadb4d3027e8ceb5e6f5788c6b4d4432350c043; no git changes by this worker.

## Finite plan and next exact gate

Heights[5,8,2,4,5,3,4] =112 nodes, native capacities and two varied candidate workload counts in DEVELOPMENT-CATALOG-PLAN.md. No actual jobs frozen before keys/deployment. No D256 or large-roster qualification.

100GiB maximum namespace incl transients;100GiB freefloor;8GiB/artifact;24GiB+16MiB reserved per stage. Thus unmeasured84GiB total projection currently does NOT fit through the graph under conservative reservation. First stage and later first-recursive measurement must establish costs; do not raise budgets. Single stage only,4M constraint guard before Setup,60min wall,2GoCPUs/soft6GiB. Other active work must respect the same one-heavy-process engineering gate; builder lock coordinates only its namespace.

The reviewed stage0 is first attribution leaf family/2/0/0/0; it requires no prior keys. Parent next: confirm82164 engine verdict, independently accept frozen source/schema and truthful development provenance, issue a separate exact execution-authorization document/pin, then canonical config with those pins and this builder hash. No configuration bearing a fabricated approval was created. The provenance-plan explicitly says NOT EXECUTED / PENDING authorization and must not be presented as an executed ceremony or permission. Run plan/preflight against the real config before the one-stage action; parent remains owner of that internal engineering gate, not a user blocker. No fullgraph authorization requested or assumed.

Future single-stage CLI: catalog-builder -action=stage -config=<canonical-config> -config-sha256=<external-pin> -stage=0 -authorize-development-setup. Return receipt exact hash, constraints, compile/setup/write/wall, RSS, CCS/PK/VK bytes and projected remaining storage before any subsequent stage. Later stages need prior receipt pin and first-costs pin; no automatic graph action.

## Contract consumer coordination

verifier.ExportEVM(ctx, authoritativeSnapshot, artifactBytes) returns fully verified384-byte0x proof,22 decimal uint64 limbs, manifest and ordered authenticated leaves. Compression/proof hash semantics unchanged. runtime/evm_export_notes.md provides exact ABI and leaf mapping. Historical exact Solidity bytes were matched; no new proof or EVM acceptance claim. Parent-assigned contract owner deploys actual finalVK verifier before freezing two sourced jobs and consumes this API, retaining commitment/PoK. Actual runtime executable Advance/restart/two jobs sameVK + positive contract acceptance remain next execution evidence, not completed work.

No heavy compile, setup, proving, PK persistence, source-pin/old-artifact modification, service/contract edit, git, deployment or production promotion performed by this increment. The development artifact namespace remains untouched by the builder. All current subprocesses collected.
