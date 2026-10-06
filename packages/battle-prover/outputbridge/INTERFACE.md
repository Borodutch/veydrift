# Output bridge v1 — integration contract

Only this new package is owned here. No contract/composition/qualification edits.

## Solidity wire format (fixed)

`battleBinding` is the full256 `qualification.LinkedStatement[3:7]` ChainRecord, NOT the old SHA qualification digest. The contract independently reconstructs the seventeen-word ChainRecord from authoritative AwaitingProof job storage per `../qualification/LINKED-INTERFACE.md`. It includes the actual raw snapshot and randomness context. Never reduce any digest modulo Fr.

`LEAF_DOMAIN = keccak256(bytes("veydrift.proof-battle.output-leaf.v1"))`
`TAIL_DOMAIN = keccak256(bytes("veydrift.proof-battle.output-tail.v1"))`

All encodings are Solidity `abi.encode` static words (not packed):

```
tail = keccak256(abi.encode(TAIL_DOMAIN, battleBinding, uint256(memberCount)))
node[i] = keccak256(abi.encode(LEAF_DOMAIN, battleBinding, uint256(i),
  uint256(cohortId), address(owner), uint256(source), uint8(side), uint8(unit),
  uint32(enrolledCount), uint32(lost), uint32(survivors), bytes32(node[i+1])))
```

Exactly 12 words /384 bytes per node; 3 words /96 bytes per tail. Root=node[0]; empty root=tail. Counts/index/cohort/source full256; members positive uint32; zero-loss rows MUST occur. Terminal loss+survivors=enrolledCount. Canonical order is authenticated preparation cohort order, then owner/source order within each cohort; not mission enrollment/loot order.

Solidity accepts/fixes root once, stores expectedDigest=root,nextIndex=0, then verifies each next indexed leaf hash against expectedDigest BEFORE applying its casualty delta and advancing to supplied node[i+1]. End requires nextIndex==memberCount and expectedDigest==tail. Batch size is operational work bound, never a gameplay roster cap. Never write frozen survivor totals over current inventory.

## Circuit schema

`Step.Statement() Statement [5] = [Binding, BeforeHash, AfterHash, Finished, Result]`.
`Shape(kind)` uses compile-time Begin0, Open1, Member2, Close3, Finish4; Done5 has no circuit. Bounded one-row steps; counters and aggregates full256.

Manifest contains resultbridge.Context, Pipeline[8] (existing composition public order), RawResult, ChainRecord4, Root4. Binding=MiMC domain441201 over the exact Manifest.Values() order implemented in types.go. State commitment domain441202; terminal Result domain441203 over Binding. No terminal value exists for an incomplete prefix.

Final Solidity public order is `Settlement [22]`:
0..3 ChainRecord LE64; 4..7 Root LE64; 8..11 memberCount LE64; 12 rounds; 13..16 finalSide0 LE64; 17..20 finalSide1 LE64; 21 outcome. Rounds/outcome are range checked; full-width limbs each <2^64.

`AssertLinked`, `AssertComplete`, `AssertAuthenticated` are equality/coverage constraints, NOT proof verification. Final composition MUST verify the entire output range, existing complete pipeline (including ALL attribution Close obligations and report), LinkedQualification, and complete rawbridge prefix under fixed approved keys. `AssertAuthenticated` links all those VERIFIED statements, including raw terminal Result to LinkedQualification.RawResult, context/input to pipeline, allocation/report/completeResult to reconstructed streams, and emits Settlement. Passing private statement advice is NOT authentication. This package does not activate production or supply trusted keys.

Native New/FromBridge APIs construct advice only. Persist explicit State plus verified prefix; a host checkpoint alone cannot authorize restart. Parent owns recursive authentication/final verifier integration.
