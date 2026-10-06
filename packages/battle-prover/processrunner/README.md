# Pinned, hard-limited proving subprocess supervisor

This package is **not a cryptographic Runner**, proof verifier, signer, service,
or deployment. It returns **unverified** engine bytes. There is no default
executable, default manifest, READY endpoint, transaction submission, credential
resolver, or shell command interpretation.

## API

- New(Config) requires exact trusted ManifestSHA256, engine/launcher/rules/verifier
  SHA-256 pins, absolute executable paths, positive resource and IO limits.
  Unsupported OS/architectures reject construction.
- Run(ctx, Request, chan<- CheckpointEvent) returns Result/error. Request requires
  full immutable service Identity.Key(), matching rules/verifier manifest hashes,
  canonical input bytes and optional prior Checkpoint envelope. Snapshot authority
  and cryptographic checkpoint validation belong to the real Runner adapter.
- A receiver persists each event.Checkpoint through the queue's **current fenced
  lease**, then sends nil/error to event.Ack exactly once. Ack is buffered; late
  acks do not block. Error aborts the process. A missing receiver or ack is bounded
  by context/wall deadline; no user callback runs inside supervisor goroutines.
  Never close the caller-owned delivery channel while Run is active.
- Checkpoint envelope = Identity + ManifestSHA256 + Data. Persist the complete
  envelope, not Data alone. Changed identity/manifest cannot resume old artifacts.
- Result = Identity + ManifestSHA256 + Proof. Feed Proof into the trusted complete
  battle verifier before the durable service is allowed to mark a job complete.
  An engine returning a result or exiting zero is **not proof verification**.

A Runner adapter owns a bounded checkpoint receiver goroutine and waits for it
on teardown. It must use a context-aware/fenced storage path: a receiver still
persisting after cancellation must not revive an expired/invalidated lease.
There is deliberately no direct dependency on service or its runner interface.

## Wire protocol

Stdin: exactly one JSON object (Go JSON spelling), no shell or CLI payload:

    {"Protocol":"veydrift-prover-process-v1","Identity":"<64 lowercase hex>",
     "Attempt":"<random invocation nonce>","ManifestSHA256":"<64 lowercase hex>",
     "Input":"<base64 public bytes>","Checkpoint":"<base64 prior data or null>"}

Stdout: NDJSON records with exactly Type, Identity, Attempt, Data. Type is
checkpoint or result; Data is nonempty base64 bytes. Every record must echo the
current identity and random attempt nonce. At most one result, always last;
trailing records, unknown fields/types, missing/oversized artifacts and nonzero
exit all fail. Total stdout and stderr budgets apply to the whole invocation;
individual checkpoints/results also have separate payload caps. Stderr is drained
within its own cap and discarded, never copied into logs/errors. On timeout,
crash or cancellation no result is returned.

## Linux enforcement

Supported: Linux amd64/arm64, static native ELF engine and launcher, procfs,
memfd seals, CPU affinity, rlimits, and unprivileged seccomp BPF. Any missing
mechanism fails closed; there is no unenforced fallback.

Build and review the bundled launcher, then independently pin its digest in the
trusted manifest (hash of json.Marshal(Manifest) in declared field order). Both
engine and launcher bytes are hash-verified and copied into sealed memfds before
execution. Renaming or overwriting source files cannot change an active
invocation. Static ELF only: dynamic loaders/libraries are rejected rather than
left outside the executable pin. Binaries are capped at 512 MiB each. Pinning,
storage buffers and supervisor overhead are outside the engine's allocation;
budget host memory accordingly.

The launcher, before executing the engine:

- sets equal soft/hard RLIMIT_AS (virtual address space), RLIMIT_CPU (aggregate
  CPU-seconds across threads), RLIMIT_FSIZE, RLIMIT_NOFILE=64 and RLIMIT_CORE=0;
- selects exactly Config.CPUs allowed CPU-affinity entries;
- applies NO_NEW_PRIVS and architecture-checked seccomp (including x32 rejection);
- denies fork/vfork and non-thread clone, returns ENOSYS for clone3, and denies
  later limit/affinity changes, process-group/session escape, namespace escape;
- executes the sealed engine with only stdin/stdout/stderr and a fixed minimal
  environment: GOMAXPROCS, private HOME/TMPDIR, LANG. No inherited secrets/PATH.

Threads share one process address-space/CPU budget; spawning subprocess workers
is intentionally unsupported. Go threads still work. RLIMIT_AS is a conservative
**virtual-memory** hard cap, not an RSS/cgroup measurement: Go reserves virtual
address space, so small limits can correctly fail at runtime startup even when
RSS is low. Affinity limits CPU concurrency, not a fractional quota. Set limits
consistently with queue reservations; multiple supervisors require queue capacity
coordination. An outer container/cgroup should additionally bound host overhead,
thread count, filesystem space and all processes for production.

WallLimit must be >0 and <=60 minutes; earlier context deadlines win. Cancellation
kills the process group. Linux WNOWAIT retains the leader's PID until all group
signals finish, avoiding signaling a recycled PID. Every child is reaped. Private
working directories are removed after execution. Caller checkpoint ack stalls
cannot prevent engine termination or bounded Run completion.

This is a resource supervisor for **trusted pinned code**, not a hostile-code
filesystem/network sandbox. The engine can access files/network allowed by its
OS account/container. Production must use a dedicated no-secret, no-network
container/account and read-only key assets. No such deployment is supplied here.

## Checks

From packages/battle-prover:

    go test -race ./processrunner/...
    go vet ./processrunner/...
    sh processrunner/verify-linux.sh

The Linux script builds static fixture binaries in a temporary directory. On
Linux it runs directly. On macOS it uses an already-local ubuntu:24.04 Docker
image with --pull=never, --rm, no network, read-only root, all caps dropped,
no-new-privileges, 1 GiB container RAM, two CPUs, 64 PIDs and a 64 MiB tmpfs.
It neither installs images nor changes services or host infrastructure.

macOS New always fails closed. Native macOS tests exercise only JSON lifecycle,
child failure/deadline/cancel, hash checks and stale checkpoint rejection—not
Linux resource enforcement or process-group guarantees. Linux tests additionally
prove actual hard limits, denied fork/group/limit/affinity escape, oversized mmap
ENOMEM, CPU SIGKILL before wall timeout, descendant group cancellation, and
sealed executable immutability. The fixture engine is explicitly **not a prover**.
