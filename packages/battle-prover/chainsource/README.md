# Finalized public chain source

	type Config struct { /* see rpc.go: all budgets required */ }
	New(Config, *http.Client) (*Source, error)

Source implements service.Source: Finalized, Pending, Snapshot, Canonical. Observe(ctx, decimalBattleID, head) derives an exact identity from a public event hint before calling service.Discover. No event payload is admitted as authority. No signer, credential loader, new dependency, deployment, private witness/key file, proving operation or READY state exists here.

## Authority and format

- Caller approves chain ID, game proxy, deployment block, version3 release, engine address, verifier address/codehash and proof/key-manifest SHA256. Rules/catalog must also equal qualification.RulesID()/CatalogID(). Approval is configuration, not a claim that this proposed release is deployed or activated.
- Every call/code read uses EIP-1898 {blockHash,requireCanonical:true}; each whole operation rechecks chain, finalized height and block hash before/after. Unsupported providers fail without latest fallback. Public log pages are number-bounded and each returned block hash is checked. Canonical compares historical anchor to the supplied finalized head.
- Pending scans all public journal topics from DeploymentBlock AND every ID in [1,nextFleetId). The latter is necessary because the current contract has no enumerable pending index: a lost launch event cannot silently erase a pending job. Pending state comes from proofBattleRecord(kind0), not an AwaitingProof event. Only phase3 is eligible. Missing journal for an authoritative phase3 job is an error, never a successful empty set.
- Header/source/rows are read from kinds1/3/2 and compared byte-for-byte to public events. Exact rawbridge ABI encoding reconstructs the entire journal and seal. Canonical widths, source membership/lane completion, row sequence, side/owner/type and consistent owner research are checked before returning authority. The original16-word header (body/moon/generation/resources/raid data included) and32-word missions are unchanged.
- Engine kind5, request(), battleRequestPolicy() and battlePurposeContext() are read at the same head. Requester/purpose/precommit/fulfilled word/snapshot policy/context must match the stored phase3 job and linked qualification formulas. Verifier code is hashed at that head. ChainRecord is the exact17-word linked qualification public record, full256.
- Snapshot.Input is encoding/json.Marshal(Document), no whitespace/newline. Public ABI records are lowercase0x exact bytes; chain/battle/source/index values use canonical decimal strings, preserving uint256. SHA256 of these exact bytes is Identity.InputHash. Rules is the rules digest; Identity.Verifier is the configured approved key-manifest SHA256, not an address. Anchor is the ORIGINAL ProofBattleSealed block, never the observation head or later AwaitingProof event. Identical replayed RPC logs deduplicate; a second distinct seal fails. JSON includes that immutable anchor, frozen release, engine request/policy and ordered source/row journal. No live mutable planet/research fields substitute for stored journal data.

## Operational limits / completeness

BlockPage and FleetPage set explicit page sizes. MaxPages bounds each complete log scan and fleet scan, MaxFleetReads bounds total reconciliation reads, MaxLogs bounds retained public logs, MaxRows bounds rows per job; MaxResponseBytes and MaxInputBytes bound HTTP and canonical JSON bytes. None is a protocol fleet cap. Exceeding any budget returns ErrIncomplete with NO successful prefix; pending count overflow returns service.ErrBackpressure. Increase the budget or provide a future reviewed enumerable contract index; do not interpret errors/partial pages as finalization. Current reconciliation is intentionally O(nextFleetId + historical logs) with bounded retained memory, no untrusted persistent cursor/cache. Full256 Observe works directly; a gigantic fleet range fails explicitly rather than truncating to uint64. HTTP client defaults to30s timeout; callers should additionally use a pass deadline and appropriately sized budgets.

The RPC endpoint remains a chain-authority trust boundary: EIP1898 and hash checks detect inconsistent/reorganized replies, not a fully colluding provider fabricating chain history/state. This is not an Ethereum light client or storage/receipt-proof verifier. A provider silently omitting log entries is detected for phase3 journals via stored row count and seal hash; getter enumeration prevents missed discovery. Omissions of irrelevant nonpending history cannot be cryptographically proven from eth_getLogs and do not create proof jobs.

## Parent integration remaining

Wire this source into service.New only with a REAL Runner. Decode Document with strict schema/ABI checks, derive preparation roots from all journal rows, build/authenticate every rawbridge/preparation/combat prefix, and verify complete final composition with Document.ChainRecord as independently expected public authority. Do not treat this reader, Build advice, JSON SHA or seven arbitrary scalars as a proof. Supply approved key-manifest identity and actual release configuration only after release policy review. Lifecycle activation, deployed verifier, recursive proof keys/composition, result application and settlement remain outside this package; an inactive onchain deployment is compatible with offline tests and produces no invented jobs.

## Offline verification

	GOMAXPROCS=2 GOMEMLIMIT=2GiB go test -race ./chainsource -count=1
	GOMAXPROCS=2 GOMEMLIMIT=2GiB go vet ./chainsource

Fixtures exercise HTTP JSONRPC only, with a frozen inactive-release-style public lifecycle. Tests cover paginated complete scan, getter authority over event claims, partial final-page failure, missing/duplicate/conflicting events, original/superseded anchors, reorgs, altered body/source/snapshot/hash, mixed-owner research, engine identity/policy/word, exact width checks, full256 chain/battle/body/request/seed and resource budgets. No production RPC is contacted.

### Independent-review follow-up

`TestBypassRejectsStaleEventDiscovery` verifies phase4 is excluded by Pending and rejected by Observe/Snapshot even when stale phase3 event hints remain. Conversely, a phase3 getter claim plus a bypass event fails journal validation.

`TestFoundryGameFixtureInteroperability` reads the unchanged `docs/battle-proof-qualified-input-fixture.json` from the real Game/modules/oracle Foundry lifecycle fixture. Offline Foundry `cast abi-encode` independently checks all getter kinds0–5 bytes envelopes, header/source/row event encodings and journal tuple ordering, reproducing the ORIGINAL pinned snapshot and randomness context. This is replay of an existing concrete Solidity fixture, not a fresh deployed EVM or live RPC test. It requires cast (otherwise explicitly skipped). The checked-in fixture labels are test-only and are asserted rejected by production New. A separate explicitly rebound HTTP fixture uses the supported linked rules/catalog and local code/seed/request metadata; it preserves the original16-word body header and both raw research rows, and recomputes commitments rather than claiming the rebound hash is the original Solidity hash. No production allowlist or core source changes were needed.

Race-test output is captured in `review-followup-evidence.txt`; verification commands use GOMAXPROCS=2 and GOMEMLIMIT=2GiB. No sibling contract/fixture files were modified.
