# Process supervisor evidence — 2026-10-05

Final command (exit 0):

    gofmt -w processrunner
    go test -race ./processrunner/...
    go vet ./processrunner/...
    sh processrunner/verify-linux.sh

Native macOS arm64 race tests: PASS, 3.034s. Vet: PASS.
Linux amd64 and arm64 static launcher cross-builds: PASS.
Actual execution: Linux arm64 Docker Desktop kernel 6.12.5-linuxkit,
local ubuntu:24.04 image, bounded disposable container per verify-linux.sh.
No image downloads, privileged container, host/service configuration changes or
persistent test container. All commands and child processes collected.

Actual Linux checks (all PASS):

- TestLinuxActualHardLimits: 0.03s. /proc/self/limits confirms equal hard/soft
  address space 2147483648 bytes, CPU 2 seconds, file 32768 bytes, nofile 64,
  core 0. sched_getaffinity confirms exactly one CPU. 3 GiB mmap returns ENOMEM.
  Attempts to fork, alter limits/affinity, setsid and setpgid are denied.
  Engine environment contains only GOMAXPROCS, HOME, TMPDIR and LANG.
- TestLinuxCPUAndWallKill: 1.24s. CPU loop receives kernel SIGKILL with 1-second
  hard CPU limit before 5-second wall deadline. Sleeping child is killed at
  200ms wall deadline, returning context.DeadlineExceeded.
- TestLinuxCrashOutputAndCheckpoint: 0.09s. Crash and oversized stdout rejected;
  acknowledged checkpoint/result protocol exercised with UNVERIFIED test data.
- TestLinuxSealedExecutable: 0.03s. Sealed memfd writes return EPERM; overwrite
  of original path cannot change active executable bytes; stale hash rejected.
- TestLinuxGroupCancellation: 0.01s. Parent and spawned test descendant stop;
  leader retained with WNOWAIT until process-group signaling completes.
- Protocol, stale identity/attempt/checkpoint, duplicate result, unknown fields,
  oversized result/checkpoint/line, checkpoint rejection, child crash after
  result, stderr overflow, cancellation and unsupported-platform cases pass.
- TestUnacknowledgedCheckpointHonorsDeadline: 0.21s. Both blocked delivery and
  blocked ack terminate within deadline without a user callback goroutine.

Linux run concluded PASS. These fixtures are NOT battle proof evidence.
Linux amd64 runtime enforcement was not executed (cross-build only).
Static real engine, trusted production manifest/key assets, actual Runner
adapter, complete cryptographic verification and deployment remain unintegrated.

source-sha256.txt binds the reviewed source files used by these checks.
