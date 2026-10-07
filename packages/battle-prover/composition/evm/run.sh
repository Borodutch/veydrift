#!/bin/sh
# Isolated local EVM only. Run from any directory; no RPC/broadcast/setup/proving.
set -eu
cd "$(dirname "$0")"
python3 check_provenance.py > provenance.json
forge --version > toolchain.txt
cast --version >> toolchain.txt
forge config --json > config-effective.json
# Genuine positive boundary must pass BEFORE the mutation suite is executed.
forge test --match-test testActualSettlementProofAndGas -j 2 -vvvv > positive-evidence.txt 2>&1
forge test -j 2 -vvvv > forge-evidence.txt 2>&1
forge inspect public/Verifier.sol:Verifier abi --json > public/verifier.abi.json
python3 summarize.py > measurements.json
python3 check_provenance.py > provenance-after.json
shasum -a 256 public/Verifier.sol public/fixture.json public/verifier.abi.json public/verifier.runtime.hex public/verifier.init.hex test/SettlementVerifier.t.sol foundry.toml check_provenance.py summarize.py run.sh > artifact-sha256.txt
shasum -a 256 -c artifact-sha256.txt > artifact-check.txt
printf 'PASS: provenance, genuine positive, all negative cases, artifact checks\n'
