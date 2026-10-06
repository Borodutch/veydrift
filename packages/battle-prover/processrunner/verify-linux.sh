#!/bin/sh
# Test-only, no image pulls, package edits, deployments or service changes.
set -eu
cd "$(dirname "$0")/.."
tmp=$(mktemp -d "$PWD/processrunner/.linux-check.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
case "$(uname -s)" in
 Linux)
  case "$(uname -m)" in
   x86_64) arch=amd64 ;;
   aarch64|arm64) arch=arm64 ;;
   *) echo "Unsupported Linux architecture" >&2; exit 1 ;;
  esac
  container=no
  ;;
 Darwin)
  arch=$(docker version --format '{{.Server.Arch}}')
  case "$arch" in amd64|arm64) ;; *) echo "Unsupported Docker architecture" >&2; exit 1 ;; esac
  container=yes
  ;;
 *) echo "Unsupported host" >&2; exit 1 ;;
esac
GOOS=linux GOARCH="$arch" CGO_ENABLED=0 go build -trimpath -o "$tmp/limitexec" ./processrunner/cmd/limitexec
GOOS=linux GOARCH="$arch" CGO_ENABLED=0 go build -trimpath -o "$tmp/engine" ./processrunner/testdata/engine
GOOS=linux GOARCH="$arch" CGO_ENABLED=0 go test -c -o "$tmp/processrunner.test" ./processrunner
if [ "$container" = no ]; then
 PROCESSRUNNER_LINUX_ENGINE="$tmp/engine" PROCESSRUNNER_LINUX_LAUNCHER="$tmp/limitexec" "$tmp/processrunner.test" -test.v -test.timeout=60s
else
 docker run --pull=never --rm --network none --read-only --cap-drop ALL   --security-opt no-new-privileges --pids-limit 64 --memory 1g --cpus 2   --tmpfs /tmp:size=64m -v "$tmp:/evidence:ro"   -e PROCESSRUNNER_LINUX_ENGINE=/evidence/engine   -e PROCESSRUNNER_LINUX_LAUNCHER=/evidence/limitexec   ubuntu:24.04 /evidence/processrunner.test -test.v -test.timeout=60s
fi
