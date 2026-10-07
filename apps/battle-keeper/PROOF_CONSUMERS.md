# Inactive proof consumer increment

No production proof submission or deployment is enabled. The standalone keeper's existing release guard remains unchanged. The reviewed proof-runtime list is intentionally empty; getter success and frozen verifier metadata do not qualify a release.

Implemented:
- Existing keeper progress reads recognize staged16/17, read frozen record kinds0/5, settlement cursor, verifier runtime and frozen-engine request/context at the SAME EIP-1898 canonical hash. RPC/decode/binding failure is not legacy fallback.
- Ordinary keeper resolution is suppressed for proof waits/applying/unqualified runtime. A qualified future planner distinguishes preparation, request-bound readiness, proving, application and nonmonotonic17->11/12 economics. Readiness and application cursor participate in the existing durable high-water guard; block/phase/time alone never count as progress.
- Backend ordinary single/replacement preflight and batch candidate refresh exclude16/17. No proof-wait timeout bypass; Transport/Deploy/returns use existing paths. Existing ETH fee caps, nonce coordinator and productive batch simulations remain unchanged.
- Backend canonical reads expose separate proofBattleProgress (no percent or synthetic round count). After positively identifying a proof job, an application-getter outage remains unavailable even at shared preparation/economics stages. Retained terminal proof records allow canonical return legs at13 only under the existing runtime and paid-progress guards. Existing staged events16/17 retain conservative wait/unknown status through duplicate delivery, restart and removed-log replay. Stage17 alone cannot distinguish proving from accepted application. Authoritative pinned record+application reads can.
- Pure output suffix planner checks supplied canonical accepted binding/root/count/totals against the entire persisted stream, validates every row including zero-loss members, tail/root/current cursor and duplicate source/unit, then slices at most32 leaves. It never signs/submits, persists an acceptance claim or treats economics as terminal.

Still required before activation:
- Approved final verifier/key/runtime/module provenance and registry provisioning remain absent. The actual proofBattleAcceptedSummary getter and ProofBattleAccepted event now exist in disabled contract source; the consumer reads/archives them without qualifying unknown deployments.
- The actual Final22 submit ABI is now exported separately from the read ABI (selector0x3b29d88c,384 EVM proof bytes,22 inputs). Typed encoding is not proof verification or delivery capability. Existing read schemas now live in dependency-free packages/chain-abi/src/proofBattle.ts; JSON ProofBattleProgress lives in packages/api-types and is wired through backend and frontend mission types. Client fetches preserve its optional fields; existing mission UI renders the separate status without fabricated round progress.
- Durable prover job/artifact acquisition and authenticated manifest/report indexing. This increment does not synthesize per-round combat events from aggregate loss leaves.
- Qualify and wire production publisher/release admission to the disabled coordinated execution path described below. The adapter is tested with inert signer/RPC mocks, not genuine job delivery.
- Keeper reads preparation/economics records automatically only for a reviewed future runtime; unknown16/17 are recognized but fail closed. Backend can project their records, but ordinary16 consumption remains disabled until a qualified proof-aware writer is available.

## Accepted-summary adapter increment

- ViemMissionResolver.planProofDelivery is a read-only preview, not an automatic writer. It uses readCanonicalAcceptance to pin frozen records0/5, accepted summary, application/staged progress, implementation runtime, verifier runtime and registry storage to one EIP-1898 canonical hash. Chain ID is explicitly matched. It independently recomputes the17-word ChainRecord and frozen Version releaseId. Invalid binding/release/count/scalars/codehash, malformed cursor or canonical-read outage throws; no fallback to a cached acceptance.
- readAndPlanProofDelivery consumes the exact serialized Go runtime FinalArtifact contract in packages/battle-prover/runtime/artifact_notes.md. Source-owned JSON API type is FinalBattleArtifact. PascalCase fields, decimal strings (including digest/owner leaf values), exactly22 canonical uint64 public values; Proof is compressed gnark/base64, NOT384-byte MarshalSolidity calldata. Byte/leaf budgets are required, reject without truncation; duplicate/unknown fields and noncanonical JSON are rejected. Producer hashes are not trust anchors.
- The entire allocation stream including zero-loss rows is checked against the chain summary before at most32 leaves are encoded with the actual applyProofBattleLeaves selector. Full root, tail, cursor digest, totals, member uniqueness and identity are crosschecked every attempt. Restart/reorg uses chain cursor, not a host last-sent index. End cursor is fully authenticated; Economics never becomes a terminal/report claim. Empty accepted output still plans the contract's empty-tail application call.
- Backend SettlementIndexer archives the complete ProofBattleAccepted event in its existing atomic raw ledger, with a bounded game/battle-specific accessor. Removed events, offline canonical-range reorg detection, restored replay and restart use existing ledger handling. Acceptance is intentionally NOT classified as a legacy battle-report event and creates no round reports, winners, materialization completion or mission transition.
- Every returned plan has deliveryEnabled:false and concrete gaps: unreviewed implementation/module routing provenance, absent release approval and disabled production delivery. No signer/nonce/journal mutations occur; existing ordinary transaction guards are untouched. Raw registry1 alone cannot enable this path. The reviewed runtime list stays empty.

The frozen runtime ExportEVM interface is now decoded and the bounded file acquisition primitive is composed with canonical planning. Still needed: a real atomic publisher plus independently trusted metadata, approved key/circuit/module/runtime provenance and registry provisioning, and genuine identity-correct job evidence. The existing backend coordinator owns the disabled execution/receipt path; no new signer or nonce journal is introduced. No positive real-job proof or production submission is claimed: the known Game1/verifier7/codehash77 fixture mismatch remains unresolved.

Tests are synthetic/local only; no wallet or network transactions.

## Frozen EVM export acquisition and operation planning

The compressed FinalBattleArtifact preview remains supported separately. The new
EVMFinalBattleArtifact follows runtime/evm_export.go exactly: lowercase
schema,proof,public,manifest,leaves in producer order, PascalCase nested fields,
canonical decimal strings, all384 lowercase hexadecimal proof bytes and22 uint64
limbs. No commitment or PoK bytes are truncated or rearranged. Manifest.ProofHash
identifies the compressed native transport, not the EVM proof bytes. Parsing and
ABI roundtripping are not cryptographic verification.

parseEVMArtifact enforces configured byte/leaf bounds capped at16MiB/16,384,
rejects duplicate/unknown/noncanonical JSON and deep-freezes retained output.
readCanonicalProofJob preserves the pinned frozen identity even before acceptance;
readCanonicalAcceptance remains the accepted-only API. Unaccepted acquisition requires
AwaitingProof(3) plus stage17, after the preparation module atomically advances
AwaitingRandomness(2)/stage16; stage16 is not submission-ready. readProofOperation requires
independent trusted metadata binding chain/game/battle/ChainRecord/release to
VKHash, InputHash, compressedProofHash and SHA256 of the entire immutable export.
These are mandatory external publisher/release inputs, never copied from the
untrusted file to approve itself. No such production metadata provider is wired.

Every operation reauthenticates the whole output root/tail/conservation/totals and
cursor, then compares each source/unit/owner/count/side to the frozen on-chain rows
at the same canonical hash. It checks the anchor again after bounded file/row reads.
Unaccepted output encodes submitBattleProof with all384bytes. Matching competitor
acceptance switches to applyProofBattleLeaves at the chain cursor, at most32 leaves;
wrong acceptance/root/release or stale/reorged identity rejects. An exhausted empty
output still produces the empty-tail application call. Economics is not terminal.

Operation IDs hash the canonical proof-v1 membership: chain/game/battle/binding,
release, root, cursor/digest, action and calldata hash. Anchor and fees are excluded.
The same wire is validated by the backend adapter, independently of mission/batch IDs.
Every returned plan remains deliveryEnabled:false. Production runtime/module/key
provenance and registry approval remain unqualified, and the standalone uncapped
keeper release guard is unchanged. Local tests reuse genuine historical proof bytes
only to demonstrate byte preservation; their synthetic job/public/member fixtures
are explicitly not identity-correct proofs or evidence of contract acceptance.

## Existing-coordinator execution boundary

openProofFileProvider composes the approved fixed-directory reader, strict decoder,
independent authority lookup and canonical planner. It bounds concurrent reads and
rejects missing metadata, partial/changed files and invalid UTF-8. It has no default
production path, endpoint, automatic publisher or startup activation. See
PROOF_ARTIFACT_FILES.md for the exact immutable atomic file and trusted-parent contract.
Portable Node pre/post pathname checks are NOT an anchored openat security guarantee;
a hostile mutable ancestor is outside the approved source contract and must not be used.

ViemMissionResolutionChainClient.resolveProofOperation accepts that plan provider
but currently returns disabled BEFORE calling it or touching nonce/signer/RPC.
Its private unconnected execution path uses the SAME account/client/coordinator
instance and prepared-intent lease as ordinary backend resolution. Every plan is
reacquired before allocation, under lease before signing and before broadcast. The
existing quoteResolverGas0.0002ETH cap, Base reserves, freshness and unchanged gas
ceiling apply to exact calldata; an optional expectedBlock now also binds the quote's
actual fee anchor to the proof-state anchor. Ordinary callers are unchanged.

Prepared proof membership is tagged proof-v1; existing batch arrays and mission IDs
retain their format. Shared receipt dispatch validates canonical inclusion/revert,
never battle completion. Public receipt-only recovery needs neither artifacts nor
signer, and never reconstructs/rebroadcasts stale calldata. There are deliberately
NO proof replacements or cancellation shortcuts: unknown or locally prevented signed
intents retain the existing coordinator's explicit-recovery blocking behavior.
Controlled tests use inert mock signer bytes, not real keys or transactions. The
reviewed runtime list, registry capability and standalone release guard remain off.
