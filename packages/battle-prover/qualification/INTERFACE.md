# Qualification interface for composition3284

Public `Circuit.Statement() Statement [7]` order: [ContextHash, Input, ChainCommitment0, ChainCommitment1, ChainCommitment2, ChainCommitment3, CatalogVersion]. ChainCommitment is SHA256's entire uint256, represented as four LE uint64 limbs. Constants ContextField=0, InputField=1, ChainField=2, VersionField=6. Public witness has eight variables including gnark's constant wire.

AssertLinked(api, qualified, preparationTerminal, combat) matches ContextHash and combat Input, and version1. All three statements MUST come from verified proofs under authenticated fixed keys. Qualification also authenticates its private terminal preparation checkpoint to PreparationTerminal and binds memorybattle Input using preparation.AssertCombatInput. Prefix completeness is composition's responsibility. Never replace proof verification with these equality helpers.

Circuit private fields: Preparation preparation.Context; Terminal preparation.State; PreparationTerminal preparation.Statement; Request Request; Seed [32]frontend.Variable; Snapshot [4]frontend.Variable. Request fields: ID, Purpose, Snapshot, RandomWord protocol.Uint256; Ready frontend.Variable. New(context,terminal,terminalStatement,requestID,randomWord) builds advice. Bases(), Rapidfire(), CatalogRoot(), RFRoot() expose copied fixed catalog data/roots.

Purpose(chain,battle) is EXACT current Solidity _attackBattlePurposeHash: legacy Keccak256(abi.encode(Keccak256("veydrift.attack-battle.v1"),chain,battle)). Standard gnark legacy-Keccak gadget enforces it. No invented fixed request purpose. Seed policy1 copies RandomWord to all32 BE Seed bytes. Snapshot4 is the canonical preparation ContextHash (must be <BN254 modulus), as required by the existing preparation bridge. Identity.Catalog=1 and SeedPolicy=1. Game and Verifier are address-sized, other identity words full256.

ChainDigest(context,request) returns the full SHA256 fixed record. Crosscheck(claimed,trusted) performs full256 canonical equality. A verifier/chain adapter must compare it to a commitment independently reconstructed from authentic frozen state. A prover calling ChainDigest/Crosscheck on its own inputs is NOT authentication.

## Fixed record format

ASCII RecordDomain "veydrift:candidate2:qualification:v1:", raw32 source SHA256 bytes, then 21 uint256 big-endian words in order:
chain, game, battle, body, incarnation, impact, rules, verifier, catalogVersion, seedPolicy, targetIsMoon, rawRoot, catalogRoot, techRoot, rowCount, contextHash, requestID, purpose, snapshot, randomWord, ready.
All native field roots are canonical <Fr before encoding. Digest is never reduced modulo Fr. Solidity equivalent for an implemented adapter is sha256(abi.encodePacked(bytes(RecordDomain),bytes32(sourceSHA256),abi.encode(the21words))). This is a required crosscheck format, NOT a claim that an adapter exists.

## Explicit production STOP

ProductionAvailable=false; RequireProductionBridge always errors. Current VeydriftProofBattle journals a Keccak header/source/row stream and its seal; that raw snapshot is NOT the preparation MiMC ContextHash. The raw-journal-to-Raw/Tech/Identity bridge and independently authenticated SHA256 record are NOT implemented here. The current direct-word seed change alone cannot close that gap. Existing Solidity submit remains fail-closed and activation must remain disabled. No live chain proof acceptance, settlement, final proof, or production-readiness claim. Parent owns the remaining raw bridge. Qualification only closes catalog/RF and candidate statement seed boundaries, under the explicitly missing adapter assumption.
