# Full-width memory recursion adapter

Development-only. New `memory_range.go` is separate from the historical seven-field
`Range` adapter and its generated EVM artifacts; none of those artifacts verifies
this eight-field protocol.

Public order: Input, Before, After, Start, End, BeforeDone, AfterDone, Result.
All hashes remain complete BN254 scalars. Start/End commit to uint256 positions;
they are compared only for equality, never truncated or numerically ordered.
The leaf protocol encodes the zero genesis position as scalar zero.

`MemoryPair` compiles two approved heterogeneous keys as constants, authenticates
both children with subgroup/complete-arithmetic checks, binds input, joins state
and position commitments, and forwards the final child's result. Both children
must begin nonterminal; the left must end nonterminal with zero result. A
nonterminal parent/right child must have zero result. No terminal padding is
accepted: matching public endpoints alone do not prove a genuine identity leaf.

`MemoryFinal` compiles an approved root key and genesis state commitment, binds
all eight public values, requires zero initial position, nonzero final position,
nonterminal genesis and terminal end. The consumer still must authenticate Input
against its job and Result against its settlement; this is not an on-chain router
or approved-key registry. A caller compiling a key is responsible for approving
its leaf semantics, including nonterminal progress. The adapter cannot order hash
positions to independently establish progress. Result is not required nonzero
merely because it is a hash.

## Bounded verification

From packages/battle-prover:

    GOMAXPROCS=2 GOMEMLIMIT=4GiB RUN_MEMORY_RECURSION=1 go test ./aggregation -run '^TestMemory' -count=1 -v -timeout 15m

Each generated constraint system is capped at 4M constraints. Tests set a soft
4GiB Go memory limit and require at most two Go execution CPUs. Only SMALL child
circuits receive development Setup and genuine native Groth16 proving/verification;
recursive pair/final circuits are compiled and solver-tested. No outer Setup or
outer proof, production ceremony, recursive depth/performance or EVM claim.

The exact-transition fixture pins every field to compile-time values, including
200–253-bit hashes, modulus-minus-one Result and descending position hashes. Independent keys, a fresh
unapproved key for identical public values, and witness-key override are tested.
The separately named adversarial claims fixture intentionally has NO battle
semantics: genuine small proofs isolate adapter linkage, no-postterminal,
terminal-padding refusal, result and final-genesis guards. It must never be used
as an approved production leaf. Evidence: memory-recursive-evidence.txt.

## Actual memorybattle leaf lane

    GOMAXPROCS=2 GOMEMLIMIT=4GiB RUN_MEMORY_RECURSION=1 go test -tags memory_battle_integration ./aggregation -run '^TestMemoryBattleRecursiveLeaves' -count=1 -v -timeout 10m

This separate tagged test imports the actual full-width leaf once its package
builds; the tag isolates the independently migrated API from adapter-only CI.
It runs the real empty-roster Boot -> Ready -> Done trace, checks eight-field
public witness order, proves/verifies the two actual leaves under independent
keys, and feeds both proofs into the generated MemoryPair constraint solver.
Child Setup is limited to 150,000 constraints per circuit (Boot 112,751; Ready
119,552 in this run). Evidence is memory-battle-evidence.txt; only a collected
PASS establishes completion.

This is actual leaf authentication, not nonempty combat, deep recursion, a final
MemoryPair proof, or a MemoryFinal proof over that pair. No recursive setup is
performed. The separate fixture-based final checks must not be presented as a
completed end-to-end battle proof. The eight-field protocol has no updated EVM
verifier or deployed approved-key registry here.
