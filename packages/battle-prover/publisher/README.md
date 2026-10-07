# Verified proof publisher (additive)

This standalone producer takes one completed service job and publishes a verified
canonical EVM artifact plus an independent authority record. It never proves,
runs setup, generates keys, discovers/adopts jobs, signs, or submits transactions.
Only the final VK is loaded from the independently pinned catalog manifest;
CCS/PK files are not loaded and need not be present.

## Independent trust prerequisites

The deployment owner must approve and pin the **publisher executable** and the
SHA256 of the **entire canonical config file** independently of the prover/key
source. Passing a job-selected config/hash is not approval. This binary cannot
approve itself. No sample production pins or roots are supplied. Metadata is an
authorized verifier-publisher attestation, not new-key or production-release
approval. Catalog provenance approval remains an external responsibility.

Pre-create four disjoint absolute roots: service store, immutable approved
catalog, artifact output and authority output. All root ancestors must be
immutable to untrusted users; every path component must be a real directory, not
a symlink (on macOS use the resolved /private/... paths). The config/catalog must
be immutable during publication. Only the approved publisher may write the
**authority root**; consumers receive a read-only mount. Keep artifacts likewise
publisher-owned. Never share either writable output mount with proof workers.
Directory ownership/mount/ancestor policy must be checked by the deployment
owner: mode 0444 alone is not authority. Local Linux/Darwin filesystems must
support flock, no-replace rename and directory fsync. No network FS promises.

The service reader is a deliberately minimal **read-only layout adapter**, not
service.Open: service.Open mutates directories, config and lock files and must
not be described as read-only. This adapter reads canonical service.Job from
jobs/<key>.json and blobs/<SHA256> via bounded openat/NOFOLLOW descriptors. It
never calls unbounded Store.Blob. Complete is admission, not proof trust.

## CLI/API

Command source: publisher/cmd/proof-publisher. Once the safe window and review
permit building, use the externally pinned binary with:

    proof-publisher -config /approved/publisher.json -config-sha256 <external-full-file-sha256> -job-key <64-lowerhex>
    proof-publisher -action validate -config /approved/publisher.json -config-sha256 <external-full-file-sha256>

Config is exactly json.Marshal(Config) with no newline/unknown/duplicate fields,
using the exported structs in config.go. Every limit is explicit and positive;
MaxExportBytes must be **less than 16 MiB**, leaves at most 16384, metadata at
most 16 KiB. No root, RPC endpoint, credentials or pins have defaults. RPC URL
must be public without credentials/query/fragment; do not hide credentials in
its path. The validate action reads/validates the pinned config only, constructs
no Source and does not assert live chain, catalog or deployment approval.
Publish alone constructs the real chainsource.Source. Library production API:
LoadConfig(ctx,path,pin), Publish(ctx,approved,jobKey), Result and Authority;
ReleaseID and Basename are deterministic wire helpers. Source and fault-hook
injection are package-private for tests only.

## Exact wire contract

EVM artifact: frozen runtime.EVMArtifact, json.Marshal bytes without newline,
complete 384-byte Solidity proof, 22 canonical decimal uint64 limbs, all ordered
leaves and authenticated manifest. Full compressed runtime.FinalArtifact is
verified through frozen ArtifactVerifier.ExportEVM before hashes are produced.
Input SHA256 comes from the exact Source snapshot, VK SHA256 from the approved
final VK, binding from Source-validated Document.ChainRecord (also independently
reconstructed by runtime verifier). No artifact manifest hash is echoed as an
independent authority claim.

Authority filename is the same basename with .authority.json instead of
.evm.json, in the separate approved authority directory. All values are JSON
**strings**, in this exact order:

1. schema = veydrift.proof-artifact-authority.v1
2. chainId (canonical positive uint256 decimal)
3. game (0x + lowercase 40 hex)
4. battleId (canonical positive uint256 decimal)
5. binding (0x + lowercase 64 hex)
6. releaseId (0x + lowercase 64 hex)
7. vkHash
8. inputHash
9. compressedProofHash (SHA256 of decoded compressed proof, not Solidity proof)
10. exportSha256 (SHA256 of exact canonical EVM file bytes)
11. catalogSha256 (approved catalog manifest SHA256, not releaseId)
12. jobKey
13. jobGeneration
14. jobAnchorNumber (canonical uint64 decimal, zero allowed)
15. jobAnchorHash (service.Anchor hash, lowercase 64 hex **without 0x**)
16. artifactBlobSha256 (SHA256 of full compressed FinalArtifact JSON bytes)
17. publisherConfigSha256 (externally supplied full config SHA256)

All unqualified hashes above are lowercase 64 hex without 0x. No optional fields.
Canonical encoding is json.Marshal(Authority), no whitespace/newline. Schema
fields and numeric encodings are checked by Authority.Validate.

    releaseId = keccak256(abi.encode(uint32(version), bytes32(rules),
      bytes32(onchainCatalog), address(verifier), bytes32(verifierCodehash)))
    basename = hexNo0x(keccak256(abi.encode(uint256(chainId), address(game),
      uint256(battleId), bytes32(binding), bytes32(releaseId))))

ABI encoding is fixed 32-byte words (not packed); addresses left-zero-padded.
Release engine and manifest hash are not part of releaseId. The cross-language
fixture is testdata/filename-vector.json. Go ABI-word/Keccak computation now matches the independently computed existing-viem result supplied by the parent; expected hashes record that agreement. The optional filename-vector.mjs ethers calculator could not run because ethers was unavailable; no ethers agreement is claimed and no dependency was installed.

## Commit/recovery protocol

A stable .publisher.lock in the authority directory serializes all publishers;
never unlink it. Each file uses a cryptorandom exclusive sibling temp, bounded
write, chmod 0444, file fsync, close, atomic NOREPLACE rename and directory fsync.
Artifact first, metadata **last** as the commit marker. Consumers must ignore an
artifact without its matching authority record and all temp files.

Before either rename and again before the metadata rename, re-read the exact
Complete job (identity, generation, anchor, proof/checkpoint and remaining fields),
exact bounded input/proof blobs, fresh finalized canonical Source snapshot and
approved release. No atomic store/chain guarantee is claimed: **consumers must
revalidate current chain authority**, release approval and eligibility before
use. A late change can invalidate a previously valid file pair.

Retry re-verifies the complete original proof against current authority and
compares existing artifact/metadata exact bytes against freshly computed bytes.
Existing artifact without metadata is recoverable only if bytes are exact;
conflicts are never overwritten. Metadata without artifact fails closed and
requires explicit external manual repair; this command has no repair/delete mode.
Failed temp siblings remain ignored, with no automatic unsafe GC. An error after
rename can leave a valid pair (for example directory-fsync failure); retry the
same command to verify and finish durability. Publication failure before metadata
may leave an uncommitted artifact, never a trusted partial pair.

## Tests and current status

All files are new under publisher/. No frozen source, receipts, modules or keeper
files changed. Tests use genuine historical public proof/VK and public allocation
fixture without setup/proving, but **synthetic LOCAL source/catalog authority and
fake historical addresses**. Passing them is NOT current chain acceptance and
must never promote that fixture key. Tests cover proof verification, independent
hashes, complete/generation/anchor/proof-ref changes, invalid authority, malformed
proof/JSON, path links/traversal, bounds, concurrent publishers, all staged
write/sync/rename/metadata crash gaps, conflicts and recovery.

Parent confirmed the exclusive lightweight validation window after stages9..24 completed. Publisher was formatted, compiled and tested with2GoCPUs/soft2GiB; terminal timings/platform builds and independent-review evidence are recorded in VALIDATION.md. No live RPC, setup, proving, deployment, git or board operation was run. Current tests establish historical-proof/file compatibility, not fresh identity-correct production acceptance.
