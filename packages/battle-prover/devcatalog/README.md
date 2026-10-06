# Development public catalog builder (draft, not source-frozen)

This separate executable imports runtime's graph/template constructors. Runtime does not import devcatalog and never calls Setup. No witness API, proof creation, battle job input, secret transcript, or production activation is provided. **No real Setup or PK persistence has been run for this implementation.** Routine tests use obvious text bytes, not keys.

## CLI contract

Build separately with Go; pin the resulting executable SHA256 in Config.BuilderSHA256. The config is public canonical Go json.Marshal output (no newline, duplicate/unknown/omitted fields or alternate formatting). Pin exact config bytes externally. All actions take:

- -config=/absolute/path/config.json
- -config-sha256=<64 lowercase hex>
- -action=plan (default): graph and hard ceilings, zero writes, zero compilation/setup
- -action=preflight: plan plus namespace usage/free space/reservation outcome; zero writes, zero compilation/setup
- -action=inspect: stream-verify committed receipts/artifacts and output an **unapproved candidate**; only lock acquisition may create builder.lock
- -action=stage -stage=N -authorize-development-setup: exactly one separate killable subprocess; for N>0 also -previous=<receipt N-1 SHA256> -first-costs=<receipt 0 SHA256>

There is no automatic next-stage or whole-graph action. Stage zero returns measured constraint count, compile/setup/write/total nanoseconds, public bytes, peak RSS, CPU times. Review that receipt before choosing ANY later stage; -first-costs is explicit acknowledgment of its exact hash. Every subsequent stage additionally pins the previous receipt, chaining all dependency CCS/VK and source metadata. Hash the canonical receipt file, not a log or pretty-print. Reissuing an already committed exact stage validates it and returns it without Setup. Internal -action=worker requires inherited lock/root/config descriptors; it is not a supported direct command. No positional/witness inputs are accepted.

The only artifact namespace is hard-coded:

/Users/borodutch/.openclaw/workspace/artifacts/ticket44/dev-catalog-20261006-v2

This code does not create it during routine tests or plan/preflight. Future authorized stages create stage-NNNN.pending, write canonical gnark WriteTo ccs.bin/pk.bin/vk.bin plus receipt.json, sync, chmod read-only and atomically rename without replacing. Partial staging blocks further progress until explicit operator review/removal; no automatic cleanup or overwrite. Published files are immutable by protocol (OS owner/root can of course change their permissions); every resume verifies hashes again. Symlinks/special files/path traversal are refused, including ancestor components; /var aliases on macOS must be supplied as their actual /private paths for config files. Artifacts are hashed/written streamed with 128KiB hashing buffers and per-file caps, never multi-GiB ReadFile. Dependency loads read exactly pinned CCS/VK (never PK or witness), check CCS version/length and exact read consumption; gnark deserialization still allocates internally.

## Draft canonical Config schema

Field order is the Go struct order in catalog.go; no json tags. Example placeholders are deliberately NOT executable approval:

{
  "Protocol":"veydrift-development-catalog-v1",
  "RootHeights":[h0,h1,h2,h3,h4,h5,h6],
  "SourceSHA256":"<reviewed-source-map-document>",
  "RulesSHA256":"<64 lowercase hex qualification.RulesID commitment>",
  "SchemaSHA256":"<schema-document>",
  "ProvenanceSHA256":"<development-setup-provenance-document>",
  "BuilderSHA256":"<compiled-builder-executable>",
  "EngineeringApprovalSHA256":"<independent-execution-authorization-document>",
  "BudgetBytes":107374182400,
  "StageSeconds":3600
}

RootHeights is exactly seven explicit integers, phase-indexed by composition constants, 0..255 here. It is never silently promoted to D256. BuildCatalogGraph orders every leaf, D0, B_h/D_h pair and final adapters. The example [1,2,3,4,5,6,7] used only in unit tests produces 106 nodes and is NOT an approved production or fixture policy. Freeze source and config **after independent builder review**.

Suggested separately reviewed public source-map document:

- protocol/version; repository URL and revision (including uncommitted reviewed changes if any)
- sorted repository-relative file entries {Path,SHA256,Bytes} covering runtime templates/catalog, all transitive relation packages, devcatalog, go.mod/go.sum and public protocol constants
- toolchain Go version, OS/architecture, gnark 0.16.3 and gnark-crypto version, executable hash
- source closure/reproducible-build procedure and review identity

SourceSHA256 hashes canonical bytes of that document. The builder records the supplied identity, **does not claim that a self hash proves source closure or a reproducible executable**; the external reviewer checks this binding. Despite its inherited name, RulesSHA256 must be the protocol qualification.RulesID commitment encoded as 32-byte lowercase hex, matching chainsource.Release.Rules and service.Identity.Rules; it is NOT SHA256 of a prose rules document. A separately hashed rules description belongs in the source/provenance documents. SchemaSHA256 pins a schema document with ordered node/public-input/commitment schemas, selected heights and dependency relation meanings. Provenance document must truthfully say single-machine DEVELOPMENT gnark randomized Groth16 Setup, execution approval, namespace/resource policy, builder pin and no secret persistence. This is not a multiparty ceremony or a proof of randomness destruction. Config.EngineeringApprovalSHA256 authorizes execution only, never key promotion.

## Candidate and independent approval

Receipt fields: Protocol, ConfigSHA256, PreviousReceiptSHA256, Index, Entry (runtime.CatalogEntry), Dependencies (ordered ID/CCSSHA256/VKSHA256/ReceiptSHA256), Costs. CircuitSHA256 is canonical CCS bytes; each artifact has relative Path, SHA256, Bytes. ApprovalSHA256 is ALWAYS empty. Costs and ordered receipts are separate public evidence, not trust roots.

inspect outputs Candidate {Protocol,ConfigSHA256,Complete,Manifest,ReceiptSHA256,Warning}. Manifest uses runtime.CatalogManifest exactly; it remains incomplete until the whole graph exists and remains inadmissible even then because ApprovalSHA256 is empty. No approval command or runtime pin is generated. An independent reviewer must verify relation source, rules/schema, dependency exact bytes, development provenance, measured resource limits and the complete graph; then construct a separate canonical CatalogManifest with independently issued per-key ApprovalSHA256 attestations. Supply its exact external SHA256 through runtime CatalogConfig.TrustedManifestSHA256, never by trusting a hash found alongside candidate files. No file in this builder promotes its own hash to approval. Runtime activation/deployment remains outside this tool and task.

## Bounds and limitations

- <=4,000,000 constraints and correct public width checked AFTER compile but strictly BEFORE Setup. A too-large compile is still bounded by the worker wall watchdog; no claim of early gnark constraint interruption.
- <=3600 seconds for each subprocess (dependency verification, compile, Setup and writes together). Parent kills the process group; child's watchdog survives parent death. Inherited flock survives parent death and prevents concurrent heavy children in this namespace. Core dumps disabled. No child-spawned gnark jobs or implicit graph loop.
- GOMAXPROCS=2, GOMEMLIMIT=6GiB; memory limit is Go GC's **soft** target, not an RSS/cgroup guarantee. CPU rlimit additionally bounds aggregate CPU time to twice stage wall budget. GOMAXPROCS is not hard CPU affinity, and Go GC/OS support threads may briefly differ. Use a separately approved OS sandbox if hard CPU/memory isolation is required.
- Budget must be explicit, >=24GiB+16MiB reserve and <=100GiB. Reserve three maximum 8GiB artifacts plus bounded metadata before work; require free space >=100GiB AFTER reservation. Previous artifacts and abandoned transients count. No copying during commit. Other applications can consume disk concurrently; writes may then fail, never become accepted partial stages. This is a conservative preflight reservation, not a filesystem quota or fallocate guarantee.
- Only Linux/macOS targets have atomic no-replace publication implementation. Namespace is intentionally this development host's path. Stream hashes do not impose a hard allocator bound on approved gnark deserialization.
- Gnark Setup has no special recursive option. The same canonical keys support runtime's recursion-compatible Prove/Verify hash options; final proof uses its existing Solidity options. No proof, final VK compatibility, performance, circuit-fit or production ceremony claim has been tested here.
- No secrets, witnesses or toxic-waste exports are written. Setup necessarily holds random secrets in process memory; core dumps are disabled, but OS swap/hibernation and hardware memory erasure are not controlled by this Go program.

## Routine checks (no Setup, no real circuit compilation)

GOMAXPROCS=2 GOMEMLIMIT=2GiB go test ./devcatalog/... -count=1
GOMAXPROCS=2 GOMEMLIMIT=2GiB go vet ./devcatalog/...

Tests cover DAG order/count, explicit heights/time/budget bounds, canonical JSON rejection, streamed hashes/caps, overwrite refusal, symlink/path refusal, flock exclusion, atomic no-replace publication, immutable source conflicts, interrupted stage refusal and deliberate absence of self approval. Files in test temp directories are labeled text, not cryptographic artifacts. A future separately authorized stage-zero measurement and independent review remain prerequisites before orchestrating actual catalogs.
