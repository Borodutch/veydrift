#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export GOMAXPROCS=2 GOMEMLIMIT=6GiB RUN_FAMILY_DISPATCHED=1
shasum -a 256 composition/*.go > composition/family-dispatched-source-sha256.txt
/usr/bin/time -l go test ./composition -run TestFamilyDispatchedProof -v -count=1 -timeout=60m > composition/family-dispatched-evidence.txt 2>&1
