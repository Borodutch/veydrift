# Approved runtime catalog

## Stable API

- `CatalogConfig{Root, ManifestPath, TrustedManifestSHA256 string; MaxManifestBytes, MaxArtifactBytes int64}`. Root absolute; manifest relative. External trusted SHA hashes exact canonical `json.Marshal(CatalogManifest)` bytes (no newline).
- `OpenCatalog(CatalogConfig) (*Catalog,error)` checks approval metadata and complete graph, not eager multi-GB artifact decode. `Close() error` releases the directory handle.
- `BuildCatalogGraph([7]int) ([]CatalogNode,error)` returns all seven phases through each explicit 0..256 root height, then seven final adapter roles. `FamilyKeyID(composition.FamilyID)` and `AdapterKeyID(role)` produce stable IDs. Family IDs use phase/level/kind/arity.
- `Manifest() CatalogManifest` returns a deep copy; `SHA256() string` returns the independent manifest pin.
- `Ready(context.Context, service.Identity) error` checks Identity.Rules against manifest RulesSHA256 and Identity.Verifier against the whole catalog SHA, then validates every artifact byte/hash. This is artifact availability/readiness, NOT cryptographic circuit qualification or a successful decode guarantee.
- `Validate(context.Context,id string) error` checks current CCS/PK/VK files. `Load(context.Context,id string) (*LoadedKey,error)` additionally decodes checked BN254 gnark objects and validates schema/setup-parameter coherence. `LoadedKey{CCS constraint.ConstraintSystem; PK groth16.ProvingKey; VK groth16.VerifyingKey}` is a fresh caller-owned object for real `groth16.Prove` / `groth16.Verify`. Match recursion/native options to the approved circuit; no setup path exists.

## Graph and approvals

At height 256 in all phases the graph has **3,634 nodes**: 36 elementary leaves, 3,591 dispatch/binary keys, seven adapter keys. It is topological: attribution precedes CompleteClose; the latter explicitly pins attribution D_root. D0 uses the actual leaf catalog, B_h pins D_(h-1), D_h pins [B_h,D_(h-1)]. Roles are qualification (LinkedCircuit, 7 public), prepared-combat (8), bridge-report (8), pipeline (8), raw-qualified (1), output-pipeline (1), final (22). Smaller heights are explicit capacity-limited catalogs, never advertised as full uint256 coverage.

The manifest commits source/rules/global schema identity, gnark 0.16.3/BN254, exact roots/ordered roles/dependencies, and each circuit/source/schema/approval/provenance digest. Each dependency additionally pins its exact VK hash. Each CCS/PK/VK records relative path, exact byte length and SHA256. Missing/duplicate/reordered nodes, arbitrary dependencies, malformed digests, missing provenance, unknown fields, noncanonical JSON and traversal fail closed. Approvals are attestations by whoever independently approves the manifest SHA; this loader cannot infer an audited circuit or honest setup from arbitrary key bytes. It neither promotes historical development receipts nor produces setup material.

## Filesystem and resource boundary

`os.Root` provides descriptor-rooted containment including rename races. Static symlink components and final symlinks are rejected; final open is NOFOLLOW/NONBLOCK/NOCTTY, followed by regular-file/size checks. A concurrent intermediate symlink change still cannot escape the root or bypass exact approved hashes. Hash and decode use the same read buffer. Root is trusted deployment configuration; OS path aliases such as macOS /var are not rejected.

Manifest maximum is configurable up to 16 MiB; artifact maximum up to 8 GiB. Only one serialized artifact is buffered at a time, and no full decoded catalog is cached. Context cancellation is checked while reading and around decoding. CCS total-length/version headers are checked before gnark allocation. Gnark internal array lengths are not a hard allocation sandbox: approved artifact decoding/proving belongs in the OS-limited processrunner child. In-process context cannot preempt gnark decoding/proving.

## Verification and remaining prerequisites

Executed: `GOMAXPROCS=2 GOMEMLIMIT=2GiB go test ./runtime -run TestCatalog -count=1 -timeout=5m` — PASS, 0.508s test-package time. `git diff --check -- runtime/catalog.go runtime/catalog_test.go runtime/catalog_notes.md` returned clean (files are new/untracked until the parent stages them).

Cheap tests cover all-height graph/DAG and seven-phase leaf census; external pin and detached manifest; metadata/role/source/provenance/schema/dependency substitution; missing/truncated/tampered/oversized files; directory, symlink, intermediate symlink and FIFO rejection; unknown key/cancellation; canonical manifest and malicious CCS length rejection. Tests deliberately use metadata-only non-key bytes and assert Load rejects them. No compile, setup, heavy proof, fake runner or test-function subprocess is used.

Named dependency gaps: no approved production CCS/PK/VK manifest/artifact bundle was supplied, so successful real key-load/prove/verify qualification remains unexecuted; there is no claim of production readiness. Composition exposes the graph/families but some witness/adapter construction helpers remain test-private; the witness/engine owner must supply those APIs. Processrunner passes requests to a pinned real engine but does not itself implement that engine or catalog decoding. Supplied artifacts must be independently reviewed for the circuit/source/schema and dependency VK relation, not merely hash-approved by their producer.
