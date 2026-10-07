#!/bin/sh
# From packages/battle-prover. Local execution only: no RPC or broadcast.
set -eu
test -s aggregation/evm/public/Verifier.sol
test -s aggregation/evm/public/fixture.json
shasum -a 256 aggregation/evm/public/Verifier.sol aggregation/evm/public/fixture.json aggregation/evm/test/CombatVerifier.t.sol aggregation/evm/foundry.toml aggregation/run-evm-test.sh > aggregation/evm/artifact-sha256.txt
forge config --root aggregation/evm --json > aggregation/evm/config-effective.json
forge test --root aggregation/evm -j 2 -vvvv > aggregation/evm/forge-evidence.txt 2>&1
shasum -a 256 -c aggregation/evm/artifact-sha256.txt > aggregation/evm/artifact-check.txt
