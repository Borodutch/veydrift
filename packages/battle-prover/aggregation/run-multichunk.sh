#!/bin/sh
# Run from packages/battle-prover. Development-only, no key/proof persistence.
set -eu
export GOMAXPROCS=2 GOMEMLIMIT=6GiB RUN_COMBAT_MULTICHUNK=1
{ date -u; shasum -a 256 aggregation/*.go battle/*.go go.mod go.sum; } > aggregation/combat-multichunk-source-sha256.txt
/usr/bin/time -l go test ./aggregation -run '^TestActualCombatMultiChunkRecursiveProof$' -count=1 -v -timeout=45m > aggregation/combat-multichunk.log 2>&1
