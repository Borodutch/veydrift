# Solidity raw journal → preparation roots

Runnable solver-only implementation in this directory, with additive ../qualification/linked*.go. Bounded Begin/Source/Row/Seal circuits reconstruct exact Solidity ABI/Keccak and authenticated complete preparation Raw/Tech roots. No server assertion converts between unrelated hashes. Chain seal and preparation context are distinct, constrained through the same proved stream.

Run from battle-prover:

    GOMAXPROCS=2 GOMEMLIMIT=2GiB go test -p 1 ./rawbridge ./qualification -count=1 -v

No setup/proving required. Tests enforce4M constraint ceiling. Independent offline Foundry cast ABI/Keccak checks run when cast is installed; they ran here, not skipped. No RPC or chain writes.

Observed elementary constraints: Begin1,052,086; Source1,504,917; Row1,205,867; Seal298,101. Each fixed independently of event count. Six-step fixture includes resident row, source mission and multiple source rows. Tests reject altered header/identity, quantities/research/owner/source, duplicate source, nonmonotonic row type, omitted source lane, nonempty counts at seal, reordered/duplicated/omitted trace edges, corrupted journal/roots/counts, premature/noninitial boundary. Linked tests reject different seed (including fully rebuilt private advice), wrong purpose/precommit/request/engine/context, replayed identity, and swapped/equalized snapshots. Full digest/limb aliases rejected.

Evidence: solver-evidence.txt and abi-evidence.txt; ../qualification/linked-solver-evidence.txt and linked-regression-evidence.txt. Source SHA256 manifests are separate from old qualification manifests; old source hashes verified unchanged. No claim of proof generation or live acceptance. See INTERFACE.md and ../qualification/LINKED-INTERFACE.md for precise schemas, trust boundary and remaining recursive/final-verifier/settlement gates.
