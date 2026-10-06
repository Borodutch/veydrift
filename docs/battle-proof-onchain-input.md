# Qualified raw onchain input — inactive checkpoint

No production configuration setter/migration. Prospective version defaults zero. Only newly
allocated Attack leaders consult it. Existing flights/started battles remain legacy; ACS members
inherit leader, Transport/Deploy/hold arrivals remain proof-free. No deployment or delivery claim.

## Public game API

proofBattleRecord(id,kind,index) returns one ABI-encoded record: kind0 is
(Version,Phase,snapshot,randomnessContext,seed,rowCount), kind1 raw header bytes,
kind2 Row[index], kind3 source mission bytes[index], kind4 prospective uint32 version,
kind5 (engine:address,requestId:uint256,purpose:bytes32). Invalid kind/index reverts.
This compact facade preserves EIP-170 headroom and never returns an unbounded roster.
submitBattleProof(uint256,bytes,bytes32) always reverts ProofPipelineUnavailable.

## Raw ABI for bridge (NOT integrated gnark commitment)

See VeydriftProofBattle.sol. Namespace keccak256("veydrift.storage.proof-battle.v1").
Version=(uint32 version,bytes32 rules,bytes32 catalog,address verifier,bytes32 verifierCodehash).
Row=(uint256 source,address owner,uint32 count,uint8 side,uint8 unit,uint16 weapons,uint16 shielding,uint16 armor).
Positive lanes; source0 resident; units0..15 ships/16..23 defenses. Order: resident unit order,
leader unit order, linked scan, stationed scan; NOT canonical effective-stat order.

Events: ProofBattleLaunched(battleId indexed,version,verifier,rules,catalog,engine,requestId),
ProofBattleHeader(battleId indexed,bytes header), ProofBattleSource(battleId indexed,source indexed,bytes mission),
ProofBattleRow(battleId indexed,index indexed,Row), ProofBattleSealed(battleId indexed,snapshot,rows),
ProofBattleAwaitingProof(battleId indexed,snapshot,randomnessContext,seed),
ProofBattleBypassed(battleId indexed) for pre-enrollment no-combat protection/missing-moon bounces.
Source bytes=abi.encode(FleetMission), existing GameStorage struct.
Header=abi.encode(targetPlanetId:uint256,targetIsMoon:bool,missionTargetMoonGeneration:uint64,
generationRecorded:bool,impact:uint64,defender:address,blocked:bool,linkedLength:uint256,
stationedLength:uint256,planetResources:Resources,riftLockedResources:Resources,plunderBps:uint16).
Resources=(uint128 metal,uint128 crystal,uint128 deuterium). Planet IDs are existing identity;
moon generation is explicit. Economic fields are NOT complete settlement witness (Moon economy,
repair/reserve inputs and authenticated output application remain undone).

All hashes use Solidity abi.encode, never packed. D=keccak256("veydrift.qualified-raw-battle.v1"):
- initial=keccak256(abi.encode(D,chainid,gameProxy,battleId,frozenVersion,engine,requestId,originalPurpose,header))
- source=keccak256(abi.encode(previous,uint8(1),sourceId,encodedMission))
- row=keccak256(abi.encode(previous,uint8(2),zeroBasedRowIndex,row))
- snapshot=keccak256(abi.encode(previous,uint8(3),finalRowCount))
- seed=randomWord unchanged (32-byte BE), matching qualification candidate seed-policy1.

Stored records and public events permit full reconstruction. This digest is NOT preparation's
MiMC Raw/Tech/Catalog roots or ContextHash. The sibling rawbridge and LinkedQual circuit work
now supplies constrained raw-journal/preparation and request/seed links; qualification uses the
exact per-mission _attackBattlePurposeHash rather than a fixed replacement purpose. These circuit
relations do not themselves enable chain acceptance: authenticated recursive composition of the
complete raw/preparation/combat/result trace, the approved final verifier and its trusted chain
record crosscheck remain release gates. submitBattleProof remains fail-closed. See rawbridge/
STATUS.md and the parent release ledger for the current proof evidence and limitations.

Real existing chronology/protection/production cutoff and bounded roster qualification are used;
frozen impact-time per-owner research, resident/leader/qualified shared/held rows are journaled.
Protection/missing-incarnation bounces become Bypassed before any enrollment, then use the
existing bounded no-combat return path without reveal or proof. Their unused requests remain
unsealed and cannot be recycled/reseeded. This is NOT an outage/timeout bypass.
Actual proof battles never execute old combat math/casualty writes. All scans finish before seal. Staged16 awaits
reveal;17 is authoritative AwaitingProof. Chunk loop exits while pending rather than burning gas.
No pending/body guard is relaxed. submitBattleProof always reverts ProofPipelineUnavailable.
Verifier/codehash/rules/catalog freeze at launch, but are metadata until real verification exists.

Required settlement design: first valid proof freezes a complete ordered member-output commitment;
monotonic cursor authenticates/applies each member exactly once using casualty deltas, never old
survivor overwrites; bounded finalization conserves cargo/loot/repairs/debris/reserves/moons/returns
and indexes before unlock. No such settlement or activation is shipped in this checkpoint.
