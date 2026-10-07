# Canonical snapshot → preparation witness increment

Only new runtime files are required. Historical source pins (including source4a2), circuits, frozen artifacts, and test-only fixture APIs are unchanged.

## API and authority

- `NewPreparationWitness(snapshot, approvedRelease, limits)` accepts exactly the canonical JSON emitted by chainsource.Document, with exact SHA256, service identity, original seal anchor and out-of-band approved release binding. Unknown/duplicate fields, alternate encodings, trailing JSON, ABI width violations, source/row sequencing defects, inconsistent owner research, incomplete lanes, snapshot journal, randomness request/policy, and chain-record mismatches fail closed.
- Native rows, full-width identity, all 16 header words, all 32 mission words and journal ordering are reconstructed from the document. Catalog/rules/seed-policy come from the pinned qualification APIs. No settlement fixture, hardcoded battle roster or test helper enters production code.
- This is not independent RPC authority: chainsource must still authenticate finalized storage/events, code hashes and engine purpose context. A self-consistent attacker-created document is not authoritative merely because it passes local checks.

## Bounded preparation and restart

`Chunk(ctx, budget)` emits actual preparation.Step assignments through all five phases. Work is derived as 2 + rows² + rows + sum(count), using big integers. A uint32-max row can be admitted and progressed without materializing billions of units up front. Every chunk has an explicit positive ceiling and cancellation checks between transitions; no total-work fixture cap exists.

`Checkpoint()` returns a JSON-serializable identity/release/anchor/context/cursor/state commitment. `RestorePreparationWitness` rereads and validates the same authority, and `Replay(ctx, budget)` rebuilds private native sorting and Merkle state in bounded calls before allowing new work. Forged state poisons the object. A checkpoint is not a proof receipt: verified proof prefixes must be persisted and validated separately by orchestration. A restart replays O(prefix) work, rather than trusting serialized pointers or bypassing native transitions.

Admission/prep.New are bounded by document/row budgets but not streamed. Units and tree memory grow with completed expansion work; this increment does not claim constant-space execution. Use process-level memory/time budgets as well. Steps expose package-native pointer-bearing values and must be treated as immutable.

## Raw and qualification advice

`RawWitnesses()` reconstructs the real rawbridge.Build trace and checks its terminal journal. This is separately exposed because rawbridge has only a whole-journal Build API, not a resumable Next/Chunk API; its cost is O(journal size × tree depth) with all raw steps materialized. `QualificationWitness()` requires terminal preparation, builds the real linked qualification advice and crosschecks the document chain record. Neither function proves anything.

## Remaining full-pipeline work / precise API limits

- Generic canonical combat groups/units can be derived from preparation Member and Expand transitions. This increment does not implement the memorybattle/combat/resultbridge/attribution/report/output driver or claim a final settlement.
- preparation.Machine keeps order/keys private and preparation trees have no persistence/export API. Bounded replay avoids modifying those pinned APIs; direct instant restoration would require a new validated checkpoint API.
- memorybattle.New takes a fully materialized []Cell roster and writes it before returning. NewCheckpoint exists, but callers need reconstructed/exportable roster/RF/memory; it is not a serialized restart loader. A truly bounded roster ingestion path needs additional orchestration or a validated streaming constructor.
- resultbridge.FromMachines requires terminal native preparation/combat plus complete canonical Group slices. resultbridge.Next synchronously handles attribution internally (see resultbridge/machine.go Close), so a top-level step budget alone would hide nested work. Separate attribution stepping is needed for strict cross-stage budgets.
- resultbridge.ReportWitnesses requires the complete scan-record slice and returns the complete report-step slice. No exported report Next/resume API exists.
- outputbridge.FromBridge/New materializes all leaves and computes the reverse linked list before its bounded Chunk API. These initialization costs must be accounted for, not called one elementary step.
- Full proof/key-catalog selection, proving, receipt persistence, dynamic aggregation, final artifact verification and service.Runner integration remain outside this witness increment.

## Routine check

Run from packages/battle-prover:

    GOMAXPROCS=2 GOMEMLIMIT=2GiB go test ./runtime -run TestWitness -count=1 -timeout=5m

Tests cover empty/resident/multi-owner/source documents, moon/full-width identifiers, actual preparation constraint solving, bounded deterministic restart, tampered checkpoints, adversarial JSON/ABI/authority, cancellation/budgets, and a uint32-max lane's bounded prefix. No setup or heavy proof generation.
