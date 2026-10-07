# Verified EVM caller export

API:

    exported, err := verifier.ExportEVM(ctx, authoritativeSnapshot, finalArtifactBytes)

Returns `*EVMArtifact` only after the existing `Verify` succeeds, then checks the approved VK has exactly one commitment and 22 public inputs. No setup, proving, contract calls or deployment is performed. Compressed FinalArtifact transport remains unchanged.

Fields (JSON names):
- `schema`: existing `raw-linked-settlement22-v3`.
- `proof`: lowercase `0x` hex of the entire 384-byte BN254 `MarshalSolidity` result: A/B/C 256 bytes, one commitment 64 bytes, commitment PoK 64 bytes. No coefficient reversal or truncation.
- `public`: `[22]string` canonical decimal uint64 limbs, losslessly convertible to `uint256[22]`. Four-limb full words are LE64 at offsets 0 ChainRecord, 4 OutputRoot, 8 MemberCount, 13 FinalSide0, 17 FinalSide1; 12 is Rounds and 21 Outcome. ABI encoding still uses ordinary 32-byte big-endian words.
- `manifest`: unchanged authenticated ArtifactManifest (`VKHash,InputHash,ProofHash,ChainRecord,OutputRoot,MemberCount,Rounds,FinalSide0,FinalSide1,Outcome`). **ProofHash identifies the compressed transport proof**, not the exported Solidity bytes. Hashes remain lowercase unprefixed hex; settlement fields canonical decimal.
- `leaves`: complete authenticated ordered AllocationLeaf list (`Index,Cohort,Owner,Source,Side,Unit,Count,Lost,Survivors,Next`), all canonical decimal strings; no zero-loss omission. Nested manifest/leaf JSON names retain the existing capitalized field names.

Caller ABI: decode `proof` hex to bytes and parse `public` strings losslessly for `verifyProof(bytes,uint256[22])` (selector `0x4a2f947d`, returns nothing), or `submitBattleProof(uint256 id,bytes,uint256[22])` on the settlement module. Take id from the authoritative job; it is not an independent export claim. These are arguments, NOT a complete encoded call.

For `applyProofBattleLeaves`, map each AllocationLeaf to Solidity S.Leaf in order: `Cohort→cohortId`, `Owner→owner` (160-bit address padded to 20-byte hex), `Source→source`, `Side→side`, `Unit→unit`, `Count→enrolledCount`, `Lost→lost`, `Survivors→survivors`, `Next→next` (uint256 value padded to 32-byte hex). Index is authenticated off-chain ordering metadata, not a Solidity tuple field: the contract derives it from its cursor. Batch at most 32 leaves under current contract policy, preserving order.

Successful native export does not establish deployed-verifier codehash/identity, registry activation, matching frozen job identity, inventory eligibility, rounds/lifecycle constraints, transaction success or contract acceptance. The authentic frozen development fixture cannot be rebound to a different deployed verifier address/codehash. Deployment and genuine chain-job sourcing remain the contract owner's work.

Tests reuse genuine frozen artifacts and existing explicit TEST-ONLY approval pins, compare proof/public byte-for-byte with historical receipt.evm.json and the independently recorded Solidity-proof SHA256, verify commitment/PoK retention, and reject modified compressed proof, every public limb, rebound rounds, leaves, manifest, authority and cancellation. No production trust defaults or artifact changes.

    GOMAXPROCS=2 GOMEMLIMIT=2GiB go test -p 1 ./runtime -run TestEVMExport -count=1 -timeout=5m
