#!/usr/bin/env python3
"""Read-only source/receipt verification; no setup, proving or external services."""
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
COMPOSITION = HERE.parent
REPO = COMPOSITION.parents[2]
REVISION = '4a2b2e79503d876ae096daac493566790c4f993a'
FINAL = COMPOSITION / 'staged-public/settlement-phases-v2/full-20261005-v1/adapters/final'
RUN = FINAL.parents[1]
def digest(data):
    return hashlib.sha256(data).hexdigest()
def frozen(path):
    relative = str(path.relative_to(REPO))
    original = subprocess.check_output(['git', 'show', REVISION + ':' + relative], cwd=REPO)
    assert original == path.read_bytes(), 'differs from frozen revision: ' + relative

def main():
    manifest_bytes = (FINAL / 'manifest.json').read_bytes()
    assert digest(manifest_bytes) == '69ecc5f7db0b3ce0a2e027fac14ff0edb23b6c5473d874ca27c2b294d78f3553'
    manifest = json.loads(manifest_bytes)
    receipt = json.loads((FINAL / 'receipt.json').read_bytes())
    assert digest((FINAL / 'receipt.json').read_bytes()) == manifest['ReceiptHash']
    checked = []
    for name, expected in manifest['Sources'].items():
        path = (COMPOSITION / name).resolve()
        assert digest(path.read_bytes()) == expected, name
        frozen(path)
        checked.append(name)
    for name, expected in manifest['Dependencies'].items():
        assert digest((RUN / name).read_bytes()) == expected, name
        frozen(RUN / name)
    for suffix, expected in receipt['Hashes'].items():
        path = FINAL / ('receipt.' + suffix)
        assert digest(path.read_bytes()) == expected, suffix
        frozen(path)
    frozen(FINAL / 'manifest.json')
    frozen(FINAL / 'receipt.json')
    assert (HERE / 'public/Verifier.sol').read_bytes() == (FINAL / 'receipt.sol').read_bytes()
    assert (HERE / 'public/fixture.json').read_bytes() == (FINAL / 'receipt.evm.json').read_bytes()
    fixture = json.loads((HERE / 'public/fixture.json').read_bytes())
    assert fixture['developmentOnly'] is True
    assert fixture['schema'] == 'raw-linked-settlement22-v3'
    assert fixture['public'] == receipt['Values']
    scalars = [int(value) for value in fixture['public']]
    assert len(scalars) == 22 and all(0 <= value < 2**64 for value in scalars)
    # gnark witness serialization: public count, secret count, vector count,
    # followed by canonical 32-byte big-endian field elements.
    public = (FINAL / 'receipt.public').read_bytes()
    assert len(public) == 12 + 22 * 32
    assert [int.from_bytes(public[i:i+4], 'big') for i in (0, 4, 8)] == [22, 0, 22]
    assert scalars == [int.from_bytes(public[12+i*32:44+i*32], 'big') for i in range(22)]
    proof = bytes.fromhex(fixture['proof'][2:])
    assert len(proof) == 384
    p = 21888242871839275222246405745257275088696311157297823662689037894645226208583
    coords = [int.from_bytes(proof[i:i+32], 'big') for i in range(0, len(proof), 32)]
    assert all(x < p for x in coords)
    # A and commitment corruption used by EVM tests stays ON curve.
    for offset in (0, 8):
        x, y = coords[offset:offset+2]
        assert y and (y*y - x*x*x - 3) % p == 0
        assert ((p-y)*(p-y) - x*x*x - 3) % p == 0
    print(json.dumps({
        'frozenRevision': REVISION,
        'sourceEntriesVerifiedAgainstManifestAndGit': len(checked),
        'directDependencyManifestsVerified': len(manifest['Dependencies']),
        'receiptHashesVerified': receipt['Hashes'],
        'marshalSolidityProofSha256': digest(proof),
        'publicWitnessEqualsAll22ExportedScalars': True,
        'copiedVerifierAndFixtureByteIdentical': True,
        'corruptionPointsCanonicalAndOnCurve': True,
        'status': 'PASS',
    }, indent=2))
if __name__ == '__main__':
    main()
