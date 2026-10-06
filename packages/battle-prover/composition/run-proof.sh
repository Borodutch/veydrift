#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
shasum -a 256 composition/*.go preparation/*.go memorybattle/*.go resultbridge/*.go attribution/*.go go.mod go.sum > composition/source-sha256.txt
export GOMAXPROCS=2 GOMEMLIMIT=6GiB RUN_COMPOSITION=1
/usr/bin/time -l go test ./composition -run TestActualPipelineProof -v -count=1 -timeout=60m > composition/proof-evidence.txt 2>&1
