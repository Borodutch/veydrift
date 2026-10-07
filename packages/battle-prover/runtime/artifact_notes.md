# Authentic final artifact verifier

## API

`NewArtifactVerifier(vkBytes []byte, approval ArtifactApproval, limits ArtifactLimits) (*ArtifactVerifier, error)`; `(*ArtifactVerifier).Verify(context.Context, service.Snapshot, []byte) error`. This satisfies the runner ArtifactChecker interface. Approval fields: `VKHash`, `Rules`, `VerifierManifest` (lowercase SHA256/identity digests); limits: `MaxVKBytes`, `MaxInputBytes`, `MaxArtifactBytes`, `MaxProofBytes`, `MaxLeaves` (positive ints). No fixture/default VK trust. Parent supplies externally approved final VK and identity pins; catalog loading remains elsewhere. A catalog-loaded final VK may be serialized with WriteTo and supplied with its independently approved exact hash.

## Wire

`FinalArtifact`: `Schema string`, `Manifest ArtifactManifest`, `Public []string` (exactly 22 canonical decimal uint64 values), `Proof []byte` (canonical compressed gnark BN254 WriteTo, JSON base64, NOT MarshalSolidity calldata), `Leaves []AllocationLeaf`. Schema is `raw-linked-settlement22-v3`.

Manifest fields: `VKHash`, `InputHash`, `ProofHash` (SHA256), `ChainRecord`, `OutputRoot`, `MemberCount`, `Rounds`, `FinalSide0`, `FinalSide1`, `Outcome` (canonical decimal strings matching public values). AllocationLeaf fields: `Index,Cohort,Owner,Source,Side,Unit,Count,Lost,Survivors,Next` (canonical decimal strings, uint256 except owner160, side1, unit8, counts32). JSON must equal exact `json.Marshal(FinalArtifact)` encoding: unknown/duplicate fields, alternate spellings, extra bytes and null leaves fail closed. Empty output uses `[]` and must have the authenticated empty tail root.

## Authentication and boundaries

The verifier checks the externally approved key hash before decoding, canonical subgroup-checked key/proof encodings, exactly22 actual public scalars excluding internal commitments, round uint8/outcome0..2, authoritative input SHA256/identity/anchor and rebuilt seventeen-word ChainRecord, every manifest public field, complete ordered output leaf hashes, count/root/tail and survivor sums. It invokes real `groth16.Verify` with `solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)`. Proof slice count/point tags are checked before gnark decoding to prevent untrusted length-prefix allocations. Key bytes are deployment-trusted only after external hash comparison. Limits are operational admission budgets, not gameplay caps; exhaustion never truncates output.

This manifest exposes settlement/output facts, not the PRIVATE `outputbridge.Manifest`. The latter is authenticated INSIDE the externally approved final circuit/key; its full private MiMC context cannot be authenticated from these22 public values alone. Arbitrary private manifest metadata is not accepted or represented as verified. There is no unauthenticated suffix fallback. Proof/manifest hashes alone never imply validity.

The snapshot MUST come from authoritative chainsource, not the artifact producer. Finality, complete journal reconstruction, codehash allowlisting and randomness request validation remain Source responsibilities. This verifier independently binds the canonical Source Document and recomputes its ChainRecord from StatusABI/EngineABI. It does not turn a fabricated local Snapshot into chain authority. Production setup/circuit provenance and matching final-key/catalog trust remain externally approved deployment prerequisites.

Cancellation is checked before parsing/each leaf/before and after pairing verification; the short native pairing call itself is not interruptible. Artifact memory is bounded by configured encoded-byte limits, with expected JSON/object overhead; no claimed hard RSS limit.

## Evidence

`GOMAXPROCS=2 GOMEMLIMIT=2GiB go test ./runtime -run TestArtifact -count=1 -timeout=5m` uses the frozen full final receipt read-only and its independently crosschecked outputbridge allocation fixture. An explicit test-only VK pin is in artifact_test.go, never production code. Test authority uses fake fixture addresses and reconstructs only public journal Keccak hashes; no setup/proving/battle expansion or fixture edits. Positive verifies the real final proof and all three leaves, including zero-loss rows. Negative cases cover every public field, changed/rebound public values, wrong same-schema key, missing external trust, default non-Solidity hash, hashes/identity/anchor, omission/reorder/duplicate/extra leaves/tail, scalar widths/aliases, canonical JSON/binary, proof allocation bomb and configured budgets.
