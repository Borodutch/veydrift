#!/usr/bin/env python3
"""Extract only successful verifier measurements; do not use negative gas."""
import json
from pathlib import Path
import re
import subprocess
HERE = Path(__file__).resolve().parent
log = (HERE / 'forge-evidence.txt').read_text()
assert '5 tests passed, 0 failed, 0 skipped' in log
assert '[FAIL' not in log
positive = log.split('[PASS] testActualSettlementProofAndGas()', 1)[1].split('[PASS]', 1)[0]
deployment = log.split('[PASS] testDeploymentGasSeparate()', 1)[1].split('[PASS]', 1)[0]
def value(key, source=positive):
    return int(re.search(r'^  ' + re.escape(key) + r': ([0-9]+)$', source, re.M)[1])
artifact = json.loads((HERE / 'out/Verifier.sol/Verifier.json').read_text())
runtime = artifact['deployedBytecode']['object']
init = artifact['bytecode']['object']
def cast(*args):
    return subprocess.check_output(['cast', *args], text=True).strip()
codehash = cast('keccak', runtime)
assert codehash == re.search(r'verifier_runtime_keccak256: (0x[0-9a-f]+)', positive)[1]
assert (len(runtime)-2)//2 == value('verifier_runtime_bytes')
assert (len(init)-2)//2 == value('verifier_init_bytes')
abi = json.loads((HERE / 'public/verifier.abi.json').read_text())
assert abi == artifact['abi']
verify = next(x for x in abi if x.get('name') == 'verifyProof')
assert [x['type'] for x in verify['inputs']] == ['bytes', 'uint256[22]']
assert verify['outputs'] == [] and verify['stateMutability'] == 'view'
signature = 'verifyProof(bytes,uint256[22])'
indices = [int(x) for x in re.findall(r'^  rejected_scalar_index: ([0-9]+)$', log, re.M)]
assert indices == list(range(22))
# Export exact reproducible deployment/runtime bytes, not a new generated verifier.
(HERE / 'public/verifier.runtime.hex').write_text(runtime + chr(10))
(HERE / 'public/verifier.init.hex').write_text(init + chr(10))
print(json.dumps({
    'status': 'PASS', 'developmentOnly': True,
    'verifySignature': signature, 'verifySelector': cast('sig', signature),
    'verifyReturnBytes': 0,
    'runtimeKeccak256': codehash,
    'runtimeBytes': value('verifier_runtime_bytes'),
    'initBytes': value('verifier_init_bytes'),
    'initKeccak256': cast('keccak', init),
    'successfulVerifyCalleeGas': int(re.search(re.escape('[') + '([0-9]+)' + re.escape('] Verifier::verifyProof'), positive)[1]),
    'successfulColdStaticcallGas': value('successful_cold_staticcall_gas'),
    'localCreateGas': value('local_create_gas', deployment),
    'createChildTraceGas': int(re.search(re.escape('[') + '([0-9]+)' + re.escape('] → new Verifier'), deployment)[1]),
    'proofBytes': value('proof_bytes'), 'abiCalldataBytes': value('abi_calldata_bytes'),
    'cancunTransactionIntrinsicGas': value('cancun_transaction_intrinsic_gas'),
    'testTransactionGasLimit': 16777216, 'eachVerifierCallGasCap': 1000000,
    'mutatedScalarIndicesExplicitProofInvalid': indices,
    'onCurveProofCorruptionExplicitProofInvalid': True,
    'onCurveCommitmentCorruptionExplicitCommitmentInvalid': True,
    'errorSelectors': {name: cast('sig', name + '()') for name in ['ProofInvalid', 'CommitmentInvalid', 'PublicInputNotInField']},
    'scope': 'Local Cancun EVM verifier only; excludes game integration, live transaction/rollup fees and production key approval.'
}, indent=2))
