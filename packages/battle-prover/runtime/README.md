# Approved runtime integration increment

This directory is new work after the preserved 4a2b2e79503d876ae096daac493566790c4f993a proof snapshot. It does not modify or repin historical composition source maps, proof receipts or approvals. No runtime key is automatically approved from the development experiment.

## Components

- Catalog: complete dependency graph for seven phases at configured heights through 256, plus seven adapters; immutable externally SHA-pinned manifest with per-key source/schema/circuit/provenance/dependency hashes; approved CCS/PK/VK loading only, no Setup. A graph is not an instantiated D256 ceremony.
- Native witness increment: authoritative chainsource.Document decoding and actual bounded preparation transitions, with identity-bound checkpoints and deterministic bounded replay. See witness_notes.md for the exact implemented suffix and remaining APIs.
- Final artifact verifier: actual BN254 Solidity-target final verification plus canonical 22-field statement and full authenticated allocation suffix. See artifact_notes.md for the wire schema. Unauthenticated private MiMC manifest advice is not accepted as verified metadata.
- ProcessRunner: service.Runner adapter around the existing pinned Linux process supervisor. Exact input/identity/rules/catalog/anchor binding; durable fenced checkpoint persistence before acknowledgment; output cryptographically checked before return. NewApprovedProcessRunner wires the real catalog and final artifact verifier. No shell or Go-test command can be selected as a proving implementation by this adapter. The engine itself remains explicitly pinned external code.
- ProveApproved: real gnark Prove/Verify against loaded approved CCS/PK/VK; no compile or setup fallback. This primitive must run inside the killable engine: gnark does not expose cooperative proof cancellation. Missing ceremony assets fail closed and do not stop unrelated engineering. No fresh production proof using future ceremony keys is claimed here.
- cmd/prover-service: sequential service/chainsource/store/approved process adapter wiring; no default approvals, keys, engine, signer, HTTP exposure or deployment. Failed jobs remain visible, not silently retried.

## Executable configuration

service.example.json is intentionally **non-runnable**: required approval placeholders must be filled from an independently approved release. Durations use Go JSON time.Duration nanoseconds. Operational input/row/leaf/page budgets fail closed; they are not a gameplay fleet cap. The two-CPU/2GiB example is a conservative integration example, **not measured sufficient production proving capacity**. RLIMIT_AS is virtual address space, not the soft Go memory target or an RSS guarantee; an insufficient limit correctly rejects startup/proving. Do not raise the authorized test envelope to make a fixture pass.

Build entrypoint: go build ./runtime/cmd/prover-service. Run only on an approved Linux host with genuine engine/key assets. All approval constructors run before chain observation or proving; this change does not start a service.

## Named remaining integration work

1. Existing composition private step wrappers (prepStep/combatStep/attrStep/bridgeStep/reportStep/rawStep/outputStep) and test-only native construction helpers are not exported witness/template APIs. Moving or adding a reviewed production constructor requires coordinated edits to existing composition; copying the test fixture or reflection is not a runtime solution.
2. Existing ReduceFamily is streaming but not checkpoint-importable: private work and local frontier live inside one call. A genuine restartable variable-height executor must persist/verify every frontier proof, range, source and approved key identity before reusing it. Host CountPlan and graph generation alone are not that executor.
3. Native preparation resume uses deterministic replay. Generic preparation-to-combat/group/report/output witness streaming and durable machine/frontier state still need completion; a small fixture or supplied output leaf list cannot replace those obligations.
4. The supervised engine request currently contains input/checkpoint, identity and process manifest, but no approved-key catalog locator. The real pinned engine must obtain a read-only catalog through a reviewed fixed configuration/asset route, not an untrusted job-selected path. The supervisor deliberately strips inherited environment.
5. Process wire completion requires a final result: checkpoint-only exit is a failed attempt with a retained checkpoint, not a completed battle. A bounded multi-invocation runtime and retry policy need explicit semantics; this host does not disguise partial work as complete.
6. Future ceremony/release approval is an activation gate. It does not justify claiming that full arbitrary chain-job runtime or D256 has now been proved.

## Verification labels

Process bridge tests use private transport doubles only for acknowledgment/fencing/restart/verification-gate boundaries; those are not crypto or Linux-isolation evidence. Final artifact tests use real saved proof bytes only with explicit test-local trust. Catalog/witness tests run without production setup. Terminal evidence and independent review are recorded after collection, not inferred from running commands.

## Review gate: existing service checkpoint API

**Not release-ready:** independent review confirmed that service.RunOne passes a synchronous Store.Checkpoint callback into Runner.Prove. Store.Checkpoint can block on flock/filesystem operations without context; cancellation kills the child but cannot release RunOne execution capacity until persistence returns. This cannot be honestly fixed by detaching the callback goroutine. Existing service/ edits were outside this worker ownership and coordination was requested from the parent. Required follow-up: cancellation-aware checkpoint/lock acquisition, context propagation through RunOne, fenced writes checked at commit, joined teardown, and a contention/cancellation regression using the actual store. No existing service files were edited by this increment.

Two other independent review findings were fixed: raw checkpoint data and JSON/base64 durable envelope now have separate limits via DurableCheckpointLimit, with full-raw-budget/restart regression; a durable ordinary Failed job no longer terminates the continuous host or blocks unrelated jobs. One-shot mode, cancellation and unresolved storage/nonterminal state still fail closed.

Second independent review found no new confirmed P1/P2 in catalog, witness, artifact and approved-prove primitives. It reproduced focused tests in 21.271s under 2CPU/soft2GiB, without setup/proving. This does not clear the separate service callback gate above.
