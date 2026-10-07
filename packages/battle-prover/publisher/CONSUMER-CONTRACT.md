# Publisher / consumer contract v1

Status: implementation and independent review complete. Parent opened the bounded validation window after stages9..24; Go and parent viem vector computations agree. See VALIDATION.md for executed test/build evidence. No frozen builder sources changed.

## Files and authority record

Let D be lowercase unprefixed hex of keccak256(abi.encode(uint256(chainId),address(game),uint256(battleId),bytes32(binding),bytes32(releaseId))). Artifact: D.evm.json in the fixed approved artifact root. Commit marker: D.authority.json in a separate fixed approved metadata root. D is64 ASCII characters; artifact filename73, metadata filename79. No caller-selected filenames or per-job directory.

Authority record is exact canonical UTF-8 JSON, no BOM/whitespace/newline, in this field order, ALL values strings, no optional/extra/duplicate fields:

schema,chainId,game,battleId,binding,releaseId,vkHash,inputHash,compressedProofHash,exportSha256,catalogSha256,jobKey,jobGeneration,jobAnchorNumber,jobAnchorHash,artifactBlobSha256,publisherConfigSha256

schema = veydrift.proof-artifact-authority.v1
chainId,battleId = canonical POSITIVE decimal uint256 (publisher follows Store/Source; generic consumer filename helper may also represent zero).
jobAnchorNumber = canonical decimal uint64, zero permitted.
game = lowercase0x40hex, nonzero.
binding,releaseId = lowercase0x64hex.
All remaining fields = lowercase64hex, WITHOUT0x.
Metadata maximum16384 bytes; EVM file <=16MiB, publisher config must tighten to below16MiB. Maximum16384 leaves, with explicit configured limits.

Consumer resolver returns existing ProofArtifactAuthority: convert chainId/battleId to bigint; copy game,binding,releaseId,vkHash,inputHash,compressedProofHash,exportSha256 only AFTER strict validation and exact CanonicalProofJob identity match. Require catalogSha256 and publisherConfigSha256 match deployment-owner approved values, not values discovered from this record. Remaining provenance fields are mandatory canonical evidence, not arbitrary identity overrides. Metadata is an authorized publisher attestation in a trusted immutable readonly directory, NOT a signature or proof of approval. Do not use this record to enroll its own catalog/config pin.

Artifact bytes remain frozen ExportEVM JSON fields schema,proof,public,manifest,leaves, including original PascalCase nested fields. Proof exactly384 bytes lowercase0xhex (commitment and PoK retained);22 public decimal uint64 strings. compressedProofHash is hash of original decoded compressed proof, NOT EVM proof; artifactBlobSha256 hashes entire compressed FinalArtifact JSON. exportSha256 hashes exact EVM file bytes.

releaseId = keccak256(abi.encode(uint32(version),bytes32(rules),bytes32(onchainCatalog),address(verifier),bytes32(verifierCodehash))). It is NOT catalogSha256; engine and catalog manifest pin are excluded. binding comes from Source-validated ChainRecord.

## Atomic pair/restart rules

Publisher serializes using stable .publisher.lock in metadata root, independently re-verifies proof/source on retries, compares existing final bytes, writes artifact first and metadata LAST. Every new file: exclusive unpredictable temporary sibling,0444 permission,file fsync/close,NOREPLACE rename,directory fsync. Existing conflicts never overwritten. Export-only gap is unavailable to consumer; metadata-only gap fails closed. Failed temporary files are ignored, not automatically deleted. No atomicity with Store transitions or chain changes is claimed; keeper must retain current canonical checks.

Consumer/prover must not write either output root; deployment owner approves publisher binary+config and immutable ancestors/readonly consumer mounts. Config/catalog roots also immutable during calls. No production wiring/HTTP endpoint/registry activation introduced.

## Cross-language vector (Go / viem verified)

publisher/testdata/filename-vector.json now records actual Go agreement with the parent's existing-viem computation. ReleaseId: 0x5e9b91bfed181a6f776c1007673cb4204a49222b6d31b9a692c7b103cfdacc2e. Basename: 3a814dbb9f06f663789f320ab0d37620a729bf174baa251f83e0f4200b43d643. The optional ethers script did not run (dependency unavailable); no ethers agreement is claimed. No dependencies installed.
