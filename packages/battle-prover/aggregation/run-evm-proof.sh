#!/bin/sh
# From packages/battle-prover; local-only genuine development proof export.
set -eu
export GOMAXPROCS=2 GOMEMLIMIT=6GiB RUN_COMBAT_MULTICHUNK=1 EXPORT_COMBAT_EVM=1
test ! -e aggregation/evm/public
shasum -a 256 aggregation/*.go battle/*.go go.mod go.sum aggregation/run-evm-proof.sh > aggregation/combat-evm-source-sha256.txt
{ date -u; go version; forge --version; } > aggregation/combat-evm-toolchain.txt
/usr/bin/time -l go test ./aggregation -run '^TestActualCombatMultiChunkRecursiveProof$' -count=1 -v -timeout=60m > aggregation/combat-evm-proof-evidence.txt 2>&1
shasum -a 256 -c aggregation/combat-evm-source-sha256.txt > aggregation/combat-evm-source-check.txt
