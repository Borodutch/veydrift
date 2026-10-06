# Durable proving-job lifecycle (not a deployed prover)

Stdlib-only Go package, local POSIX storage. Run from packages/battle-prover:

    go test -race ./service -count=1
    go vet ./service

## Integration boundary

There is intentionally no executable, permissive runner, fake proof, signer,
credential handling, transaction sender, default key material, or deploy config.
A host must supply BOTH adapters to New(store, source, runner):

- Source: Finalized, Pending, Snapshot, Canonical. It must read public contract
  state at one finalized head; validate the on-chain frozen input commitment,
  game/chain identity, rules and verifier allowlists; serialize canonical public
  battle input; return the original frozen battle anchor. Pending is a complete
  bounded scan, not a truncated event page. Snapshot must reject a superseded
  identity or a battle no longer eligible for proving. Errors are not absence.
- Runner: Ready, Prove, Verify. Ready validates the pinned key/manifest assets
  against Identity.Rules and Identity.Verifier. Prove accepts exact Snapshot,
  previous opaque checkpoint, and a durable checkpoint callback. Verify MUST
  verify the complete battle proof and every public binding against the trusted
  snapshot and pinned keys. Checkpoints require equivalent validation on resume.
  No result hash, replayed trace, partial proof, or timeout is a proof.

Identity is an immutable tuple of full decimal uint256 chain/battle IDs,
canonical lowercase 20-byte game address, exact input-byte SHA-256 digest,
rules-manifest digest and verifier/key-manifest digest. These service digests
are not substitutes for protocol commitments: the adapter checks both. IDs
are never narrowed to machine integers. Block anchors are lowercase 32-byte
hashes without 0x. InputHash, Rules and Verifier use the same hex encoding.

Host flow: Open -> New -> Reconcile at startup -> Discover for event hints,
periodic Reconcile for missed events/reorgs -> List and RunOne(ctx,key) for queued
or lease-expired jobs. RunOne verifies before caching; Proof(ctx,key) reads the
content-hashed cache only after rechecking authority and cryptographic validity.
Reconcile records its last successful head atomically but deliberately does a
full bounded pending scan at restart, so a lost event cursor cannot lose jobs.
Failure is terminal until explicit Retry. A changed identity is a new job, not
silent reseeding. A reorg invalidates old proofs/checkpoints and fences workers;
identical input reanchored on the canonical chain is requeued without reuse.
Each admission/reanchor persists a fresh random generation. Delayed authority
responses can invalidate only the observed generation and anchor, including
prune/recreate or same-anchor ABA. Pre-generation experimental job records are
rejected rather than silently upgraded; archive those stores offline and rescan.

ServeHTTP offers read-only GET /health and /ready. Liveness, source lag, queue
age, no-progress (stuck) and expired lease counts are separate. Heartbeat does
not reset progress. Empty stores never report readiness before pinned keys have
been checked for a real identity. No listener is automatically started.

## Storage and concurrency

Files: jobs/<immutable-key>.json, blobs/<sha256>, slots/<n>.json,
config.json and reconciled.json. Writes use file fsync, atomic same-directory
rename, directory fsync. Crash leftovers are not read as jobs. Corrupt artifact
hashes fail closed. Store directory is trusted, private, and must be on a local
POSIX filesystem supporting flock and durable rename; NFS/object mounts and
Windows are unsupported. All processes use exactly the same Config.

Per-job and per-slot flock protect short transitions; random fencing tokens and
persisted expiry reject stale writes. Slot is reserved before writing the job:
a crash in between delays capacity until expiry, never overcommits it. Actual
RunOne execution additionally holds a per-slot OS lock for its entire lifetime:
even after lease expiry a paused or cancellation-ignoring runner cannot overlap
another execution in that slot; process death releases the lock. A per-identity
execution lock also spans claim through RunOne return, so expiry, reanchor or
prune/recreate cannot move the same live job into a spare slot. Unrelated jobs
can still claim spare slots. Neither execution lock file is ever unlinked. A broken runner
must be terminated by its host, not bypassed with a second slot reservation.
No global lock is held during proving, RPC calls, verification or progress waits.
Short admission and blob-accounting transactions are serialized.

Worker persistence uses cancellation-aware nonblocking flock retries. Checkpoint,
renew, claim, invalidation and completion paths keep the same fencing and atomic
rename/fsync rules. ContextRunner is an optional extension of Runner with
ProveContext(ctx, snapshot, resume, func(context.Context, []byte) error); runners
with an independent child deadline must pass that cancellation into every save.
Legacy Prove callbacks receive service/parent cancellation only. CheckpointContext
and RenewContext are also available directly; existing methods remain compatible.
All persistence stays synchronous: no callback can mutate after its return.

RunOne failure cleanup waits at most 100ms for transition locks. If contention
prevents cleanup, execution locks are released and the durable reservation is
recoverable after lease expiry, not immediately. Heartbeat shutdown is joined.
Disk reads, writes, open, rename and fsync are ordinary blocking OS syscalls, not
magically interruptible by context: checks occur between operations, each 64KiB
write chunk, and immediately before rename. A rename already committed is not
rolled back on cancellation, and directory fsync completes before returning.
Cancellation between blob and job commits can leave a bounded orphan blob;
cancellation between job and slot commits can reserve the slot until expiry.

Worker capacity is min(Workers, CPUs/JobCPUs, MemoryBytes/JobMemoryBytes), shared
across processes, not per instance. These are admission/reservation limits, NOT
an in-process Go heap or CPU hard limit. A production runner must use a killable
child process/container and enforce OS RAM/CPU limits matching those reservations
(and budget host overhead). This package does not yet provide that adapter.
Direct low-level Claim users must not launch computation outside RunOne's
execution lock; Claim/Checkpoint are provided for lifecycle inspection/testing.

MaxJobs bounds all retained job records. MaxInputBytes/MaxArtifactBytes bound
payloads; MaxBlobBytes caps ALL retained blobs including orphaned checkpoints.
Backpressure is an error, never success. Prune only terminal records. Explicit
GC refuses while any queued/running job exists, locks retained jobs, and removes
unreferenced blobs/crash blob temps. This intentionally conservative maintenance
window avoids racing a runner's uncommitted artifact. Lock files are never
unlinked (inode ABA safety); their tiny historical metadata and job temp files
require offline archival if identity churn is very large. No automated eviction
of complete evidence or operator-configured data is performed.

## Evidence scope

Tests cover separate-process claims, duplicate events, bounded worker and blob
admission, stale token writes, persisted checkpoint restart recovery, process
exit/orphan slot recovery, incomplete temp writes, active reorg fencing,
reanchoring, corruption, garbage collection, independent unrelated-job progress,
resource reservations surviving expired-but-live runners, key failures, rejected
placeholder/empty output, timeout failure, cache lifecycle and health distinctions.
Test runners are explicitly test-only lifecycle fixtures, NOT cryptographic
proof evidence. Actual composition/chain adapters, process resource enforcement,
and deployment must be integrated and independently proved before production.
