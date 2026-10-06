# Additive raw-linked qualification API — parent integration handoff

Old Circuit/Statement [7], SHA adapter code, solver-evidence.txt and source-sha256.txt are untouched. New LinkedCircuit/LinkedStatement [7] uses a DIFFERENT proof/key and public order:

0 ContextHash; 1 Input; 2 RawResult; 3..6 ChainRecord LE uint64 limbs (full256).

AssertLinkedStatements(api,qualified,rawTerminal,preparationTerminal,combat) binds all three authenticated dependencies. Final composition MUST verify complete rawbridge prefix (see ../rawbridge/INTERFACE.md), complete preparation/combat/attribution/result traces, and this LinkedCircuit proof. Merely supplying statement arrays never verifies proofs. Existing composition.QualifiedFinal expects the OLD SHA schema and MUST NOT consume these seven fields without an explicit new adapter.

The circuit links TWO different snapshots:
- ChainSnapshot: exact Solidity raw journal seal Keccak256(abi.encode(previous,uint8(3),rowCount)). Proved by rawbridge's terminal Result under a complete prefix.
- PreparationSnapshot: canonical preparation ContextHash <Fr in LE64 limbs, carried by memorybattle.Input. Derives from same raw bridge's Meta.Preparation and exact Raw/Tech/Rows/Identity. Never equal by assertion to ChainSnapshot.

Pinned proposed release metadata: Version=3, Catalog=bytes32(SHA256 exact pinned catalog source), Rules=keccak256(bytes("veydrift-individual-shot-candidate-2")), preparation-only SeedPolicy=1. These are candidate release IDs, not live configuration or activation. Test-only onchain catalog-fixture/rules-fixture intentionally will not qualify. Parent must approve/use these IDs when implementing registry/activation; no silently arbitrary prover catalog labels.

## ChainRecord (no prover-asserted server/adapter digest)

Keccak256 of Solidity abi.encode seventeen static words:
1 keccak256("veydrift.proof-battle.public-record.v1")
2 block.chainid
3 game proxy address
4 battle ID
5 frozen.version
6 frozen.rules
7 frozen.catalog
8 frozen.verifier
9 frozen.verifierCodehash
10 job.engine
11 job.requestId
12 job.purpose
13 job.snapshot
14 job.randomnessContext
15 job.seed (unchanged revealed randomWord)
16 job.rows.length
17 job.phase (=3/AwaitingProof).

Every item exists in game job storage or EVM execution context; none requires the chain to compute a MiMC root, trust an offchain conversion, or take a submitted commitment on faith. Final onchain verifier must recompute this exact Keccak from its storage and compare full256 to the four public limbs, enforcing each limb<2^64. Current submission stays disabled; no verifier contract was modified here.

The relation additionally constrains actual RandomnessEngine legacy-Keccak encodings: purpose=keccak(abi.encode(attackDomain,chain,battle)); precommit=keccak(abi.encode(commitmentDomain,chain,engine,word)); randomnessContext=keccak(abi.encode(snapshotPurposeDomain,chain,engine,requestID,game,purpose,precommit,ChainSnapshot)). Word nonzero and copied to all32 big-endian seed bytes. Pending/reseed/policy enforcement remains the authoritative engine/job lifecycle: phase3 chain storage can arise only after consumeRandomness; the relation cannot query chain state. Oracle liveness/censorship is unchanged.

NewLinked constructs advice only. Public ChainRecord must be the trusted chain-derived expected value at verification, not any prover-selected alternative. This is ordinary public-input authentication, not the earlier missing raw-to-prep assertion.

## Remaining gates

Arbitrary-length recursive accumulator + rawbridge proof keys/verification and new final composition adapter remain parent work. Actual final onchain verifier/storage record comparison, registry release IDs/codehash policy, exactly-once settlement and bounded economics remain unimplemented. No production activation/setup/proving or deployment performed. Old ProductionAvailable=false remains unchanged and accurate for the pipeline as a whole.
