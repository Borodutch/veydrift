# Publisher terminal implementation handoff

All changes confined to NEW publisher/**; no85 frozen Go files, go.mod/go.sum, catalog receipts, source identity, keeper/backend edits or git actions. All85 dependencies rehashed unchanged after final builds. CPU window released; no active commands/children remain.

## Delivered

Actual standalone CLI and publisher API consume one Complete Store job via bounded readonly layout adapter, reacquire finalized Source and exact identity/generation/anchor/blob refs, load approved finalVK only, verify frozen ExportEVM, independently derive metadata hashes, and publish canonical384B/22limb/full-leaf artifact then separate17-string authority commit marker. Anchored nofollow/single-link readers, explicit caps, flock, exclusive temporary writes, filefsync/close,NOREPLACE publication, directoryfsync, conflict-preserving retry. Store.Open and unbounded Store.Blob deliberately unused. No claim of atomic Store/chain publication or immunity to untrusted mutable mount ancestors.

Contracts: CONSUMER-CONTRACT.md,CONFIG-CONTRACT.md,README.md. Tests and fake Source/catalog approvals remain test-only; production cannot inject those. Publisher permissions/config authorization and consumer readonly mounts remain deployment-owner prerequisites; no key/release self-approval.

## Terminal validation

All under2CPU/soft2GiB and bounded timeouts, serial builds:
- Final publisher tests PASS2.409s; CLI tests PASS0.809s.
- go vet PASS.
- Publisher race PASS5.834s; CLI race PASS2.084s.
- Darwinarm64, Linuxamd64, Linuxarm64 CGO0 cross-builds PASS.
- Concurrent tests repeated10 with30rounds×8initial-lock contenders PASS2.554s.
- Go/viem vector agreement exact; ethers unavailable, not claimed.
- Full real historical proof export, wrongproof/source/catalog/config, Complete/generation/anchor changes, readbounds/links/JSON, concurrent publishing, injectedwrite/sync/rename/metadata failures and retries tested. Fault injection is not actual power-loss/process-kill evidence.

Recovered defect: nonexclusive lock-file O_CREAT occasionally returned ENOENT on Darwin under concurrent initial publication. Reproduced beforefix, localizedbeforeflock, corrected with O_CREAT|O_EXCL plus EEXIST-only existing-file open. No unsafe retries or relaxed path checks. Independent focused review413b6b76 PASS/noP1P2; independent diagnostic reviewf7868a7f agrees with operation localization (kernel/APFS mechanism not proven). Initial wholepublisher review6275f32d clean. Reviews were inspection, tests executed by this owner. See VALIDATION.md for failed-attempt and terminal distinctions.

## Frozen publisher identities (separate from key source)

Source manifest SHA256:
1ffdceef4c9fbd45bda20f090eca1c365ad9e3e053fe76006e0cc432e5f4364d

Frozen dependency source SHA256 (unchanged):
b8df19146f8e77ab2b4446841b26ede520648ce0a35f92011afdf235b0ef603d

Binaries in /private/tmp/ticket44-publisher-validated-20261006/:
- proof-publisher-darwin-arm64:22578b4d3ece5305afc6a008e2207f876bdb9a0265f63809beab3c37e7c781e6
- proof-publisher-linux-amd64:d4a72df9a11498a5de3a4292be2075bd867bf129a15d368e75ba07c69bf3db10
- proof-publisher-linux-arm64:5b07ca3565fab7b6614989eb4f2e6da5998acdad3a5309d6a50188dcb5d402cf

Config contract SHA256:e35cdf699581251b92288e2894b861eaf73c021f83dfd82f67888db20c832c17
Consumer contract SHA256:de472cafe7192557a9e9df221a4c885195f4326411f356bcd0d1af2b51ed3759

Exact file list/bytes and machine-readable pins: source-manifest.json,pins.json. These identify artifacts, NOT production approval. Actual deployment configSHA remains explicitly null: no approved concrete publication roots/catalog/release/RPC config supplied or activated. Deployment owner must generate canonical Config and independently supply its fullSHA to CLI; do not substitute contract-document hash as configSHA.

## Shared vector for c6

releaseId0x5e9b91bfed181a6f776c1007673cb4204a49222b6d31b9a692c7b103cfdacc2e
basename3a814dbb9f06f663789f320ab0d37620a729bf174baa251f83e0f4200b43d643
Artifact suffix.evm.json; authority suffix.authority.json, samebase separatetrustedroot. Expectedvalues populated onlyafter independent Go computation matched parentviem; fixture testdata/filename-vector.json now authoritative for this synthetic vector, not actualjobtrust.

## Remaining original #44 outcome

No fresh proof, setup/keygeneration, realRPC/job publication, contract acceptance, signed transaction or host deployment performed. Genuine local historicalproof filesystem publication is now tested, not just a library unit export; identity-correct fresh catalog/twojobs/contract acceptance and trusted consumer configuration remain parent-owned nextintegration. #44 is not completed by this handoff.
