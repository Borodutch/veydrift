// Offline vector calculator for an existing ethers installation; no RPC.
// Run only after the source-owner safe window. Do not install dependencies.
import { readFileSync } from 'node:fs';
import { AbiCoder, keccak256 } from 'ethers';
const v = JSON.parse(readFileSync(new URL('./filename-vector.json', import.meta.url)));
const abi = AbiCoder.defaultAbiCoder();
const r = v.release;
const releaseId = keccak256(abi.encode(['uint32','bytes32','bytes32','address','bytes32'],[r.version,'0x'+r.rules,'0x'+r.catalog,r.verifier,'0x'+r.verifierCodehash]));
const basename = keccak256(abi.encode(['uint256','address','uint256','bytes32','bytes32'],[v.chainId,v.game,v.battleId,v.binding,releaseId])).slice(2);
if (v.expectedReleaseId !== null && v.expectedReleaseId !== releaseId) throw Error('release vector mismatch');
if (v.expectedBasename !== null && v.expectedBasename !== basename) throw Error('filename vector mismatch');
console.log(JSON.stringify({releaseId,basename,artifactName:basename+'.evm.json',authorityName:basename+'.authority.json'}));
