#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export GOMAXPROCS=2 GOMEMLIMIT=6GiB RUN_FAMILY_PROOF=1
shasum -a 256 composition/*.go > composition/family-proof-source-sha256.txt
/usr/bin/time -l go test ./composition -run TestFamilyNonzeroProof -v -count=1 -timeout=60m > composition/family-proof-evidence.txt 2>&1
