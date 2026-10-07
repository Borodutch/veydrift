# Approved engine integration API

Implemented in engine.go; no processrunner edits:

```go
NewEngine(snapshot service.Snapshot, release chainsource.Release, limits WitnessLimits, catalog *Catalog) (*Engine, error)
RestoreEngine(ctx context.Context, snapshot service.Snapshot, release chainsource.Release, limits WitnessLimits, catalog *Catalog, checkpoint []byte) (*Engine, error)
(*Engine).Advance(ctx context.Context) (worked bool, err error)
(*Engine).Checkpoint() ([]byte, error)
(*Engine).Result(ctx context.Context, limits ArtifactLimits) (FinalArtifact, error)
```

Advance returns true after one verified proof transition, false/nil only when final proof is already complete. Each call performs at most one actual ProveApproved operation, including frontier D/B carries and unary promotions. Qualification executes at its actual native trace event; bridge Close waits for the actual cohort attribution root at the catalog-approved height. All ordinary leaves use NewLeafWitness, Close uses NewCloseWitness. Final adapters are FamilyPhaseJoin modes 0/1, Join mode2, RawQualified, OutputPipeline, SettlementFinal with actual replayed native claims. Production code has no fixture paths, reflection, test subprocesses, compile/setup, PK persistence, or configurable fake prover.

Checkpoint is canonical versioned PUBLIC JSON: authoritative trace identity/anchor/release/input digest, catalog pin, native transcript cursor/digest, explicit pending-event flag, group-bound frontier bytes and adapter NativeReceipts in canonical order. No native circuit assignment or private output Manifest is serialized. The native pending event can precede its proof; restart must replay it, never skip it. A proof failure leaves it pending. A native transition failure poisons the in-memory engine because native advice may have mutated; restore the last persisted checkpoint rather than checkpointing/retrying that instance.

Restore replays every native prefix instruction, checks all stored frontier ranges against source interval start/count/endpoints and raw leaf kind, rejects absent/extra groups, verifies qualification presence at its event, and checks each Close has its separately completed attribution root. Finish flags are accepted only after native source exhaustion (attribution may finish at its consuming Close). Adapter stages must be a contiguous prefix, match exact native public bytes, and follow completed phase roots. Every stored family and adapter proof is independently checked under the catalog-approved VK. Auth is reconstructed using ValueOfProof, ValueOfWitness, and ValueOfVerifyingKeyFixed; receipt-selected keys are never accepted.

Result is a separate library boundary, never a stage/checkpoint alias. It constructs FinalArtifact with public manifest and allocation leaves from actual native output, verifies the final adapter against exact native 22-public values, and then calls ArtifactVerifier with authoritative snapshot and approved final VK. The private native Manifest is used only in witness construction. The returned FinalArtifact is caller-owned.

## Resource and activation boundaries

Root dimensions come only from the preapproved complete seven-phase Catalog DAG, not input dimensions. Capacity is checked before leaf proving. Engine state retains O(number of groups * approved height) public receipts plus the native driver working set. Restore is O(native prefix) and context-checked; it does not yet expose chunked replay. Checkpoints are capped at 64 MiB; this is an explicit finite host resource limit, not a claim of arbitrary chain-sized materialization. Trace construction still has its documented bounded-document/native materialization limitations. Native proving/key decode remains inside the killable processrunner resource boundary. Fenced atomic persistence and stale-worker rejection remain service-store responsibilities.

No production approved CCS/PK/VK bundle was supplied. Fresh full proving success remains an activation gate; no development VK was promoted and no setup/proof generation was run for these tests. All execution branches are implemented; missing artifacts fail via the concrete Catalog/ProveApproved path, not placeholders.

## Validation

`GOMAXPROCS=2 GOMEMLIMIT=2GiB go test ./runtime -run ^TestEngine -count=1 -timeout=5m` passed (7.904s). Tests cover initial/pending checkpoint roundtrips, missing-PK failure/retry without cursor skipping, cancellation, identity/anchor/catalog/digest/cursor/group/adapter-stage tampering, and canonical JSON. Two distinct authoritative documents exercise full native execution, every phase, all ordinary leaf constructors, actual attribution/Close ordering, all adapter public claims and public artifact leaf authentication. Seven existing adapter proofs are verified under explicit TEST-LOCAL VK pins, roundtripped, and rejected on proof/public/native/key/catalog/allocation-header/point-tag changes. These frozen proof tests are cryptographic decoder/verification evidence, not end-to-end fresh engine proof success. Full `GOMAXPROCS=2 GOMEMLIMIT=2GiB go test ./runtime -count=1 -timeout=5m` passed (39.562s); `go vet ./runtime` passed under the same CPU/memory envelope.
