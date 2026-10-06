# Correction: review79f48d04 P2 — blocking executable FIFO open

2026-10-05. Parent independent rereview required; this is implementation/test
handoff, not an independent approval or production-readiness claim.

## Baseline reproduced before changing production code

Added TestPinFIFODeadlineAndCancellation and ran:

    go test ./processrunner -run TestPinFIFODeadlineAndCancellation -count=1

All four configured/replaced FIFO x wall-deadline/cancellation cases FAILED.
A 20ms limit/cancel did not return within 200ms. Each blocked open was explicitly
released by a nonblocking FIFO peer and the test goroutine collected. Raw output:
correction-fifo-baseline.txt. Historical source-sha256.txt and EVIDENCE.md are
preserved unchanged; they describe the pre-correction source, not this revision.

## Correction

- Open with O_NONBLOCK/O_NOCTTY; validate regular/executable/size constraints via
  f.Stat on the exact opened descriptor. No path pre-stat, reopen or substitute.
- Pass Run context through both engine and launcher pinning and sealing. Check
  cancellation before open, before descriptor work, around <=64 KiB read/hash
  chunks, during ELF segment inspection, throughout <=64 KiB memfd copy chunks,
  and before returning the sealed descriptor.
- Hash while reading the same opened descriptor. Sealed bytes and hash still
  refer to exactly the same immutable copy; old mutation/seal tests remain green.
- Extra regressions cover pre-canceled pinning, cancellation during chunked
  read/hash, canceled sealing, and replacing an opened regular pathname with a
  FIFO without changing the descriptor being validated/read.

Healthy local regular-file IO remains required: Go context cannot interrupt an
already-blocked kernel disk open/stat/read. This fix rejects FIFO/special-file
peer waits rather than claiming O_NONBLOCK makes regular disk IO asynchronous.

## Final validation (exit 0, all processes collected)

    go test -race ./processrunner/... -count=1
    go vet ./processrunner/...
    sh processrunner/verify-linux.sh

Native macOS arm64 race tests PASS (2.939s), vet PASS. Actual isolated Linux arm64
suite PASS. FIFO cases all return/reject in 0.00s; context/chunk and descriptor
replacement regressions PASS. Linux CPU SIGKILL, address-space ENOMEM, affinity,
seccomp denial, descendant cancellation, sealed pinning, crash/output/checkpoint
and deadline suites remain PASS. Raw output: correction-fifo-validation.txt.

Updated snapshot: correction-fifo-source-sha256.txt. No service, module/dependency,
git, deployment or infrastructure configuration changes. Disposable Linux test
container and generated fixture binaries removed by the existing check script.
