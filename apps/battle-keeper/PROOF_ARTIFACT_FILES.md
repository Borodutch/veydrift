# Inactive trusted EVM export file acquisition

This is a read-only filesystem primitive, not a publisher, discovery service, production path configuration, artifact authentication, proof verifier, or writer. Nothing wires it into keeper startup or enables delivery. No URLs, RPC, signer, nonce, producer changes, or API endpoint are introduced.

## Interface and exact filename

`proofArtifactBasename({ chainId, battleId, game, binding, releaseId })` validates both integers as canonical decimal uint256 strings (including zero; no leading zeroes, signs, whitespace or exponents), game as `0x` plus 40 lowercase hex characters, and both hashes as `0x` plus 64 lowercase hex characters. All five values must come from authoritative external identity, not artifact claims.

The basename is exactly **73 ASCII bytes**: 64 lowercase hex characters, without `0x`, followed by `.evm.json`. The 64 characters are `keccak256(abi.encode(uint256(chainId), address(game), uint256(battleId), bytes32(binding), bytes32(releaseId)))`, using five ordinary 32-byte ABI words in precisely that order, not packed encoding. Hashing avoids exceeding the common 255-byte filename limit for full-width decimal IDs. The namespace is dedicated to this artifact format; there is no raw concatenation fallback.

`await openProofArtifactDirectory({ directory, trust: "fixed-readonly-consumer-directory-and-immutable-ancestors" }, maxBytes?)` returns `{ read(identity): Promise<Buffer>, close(): Promise<void> }`. Close it in a finally block at owner shutdown. The optional budget can only tighten the fixed `MAX_PROOF_ARTIFACT_BYTES = 16 * 1024 * 1024` ceiling; zero, fractions, nonfinite values and larger limits reject. Supply the same or stricter byte budget than the decoder. Each returned Buffer contains opaque exact file bytes; decoder integration is separate.

## Infrastructure trust boundary (mandatory, not inferred)

The future reviewed startup owner must supply **one fixed, owner-approved canonical absolute directory**, readonly to the consumer, with trusted ancestors and mount namespace whose identities cannot be replaced during the reader's lifetime. The caller explicitly asserts this using the literal trust string; that string is documentation of an infrastructure prerequisite, not authentication or a permission probe. The primitive opens all descriptors readonly and writes nothing. It does not prove effective ACLs, consumer mount permissions, publisher identity, or producer provenance. An adversary with consumer-process code execution is out of scope. There is intentionally no deployed directory constant, environment variable, arbitrary per-job path, filename argument, listing, fallback, or production override.

Only the trusted publisher may add new immutable final files. Neither final inodes nor their final names may be changed, removed, replaced, relinked, or written after publication; this includes between reads and across consumer restarts. The consumer and untrusted producers must not have write access to the approved directory/files. ACLs, ownership, readonly consumer mounts and publisher permissions are deployment-owner responsibilities. If these conditions cannot be established, **do not construct this reader or produce a plan**. Mere mode bits, a successful realpath check or a trust literal supplied by untrusted code cannot establish these conditions.

Linux/macOS runtimes with O_NOFOLLOW, O_DIRECTORY and O_NONBLOCK are supported; other platforms fail closed. This implementation does **not** provide openat/openat2 or anchored descriptor-relative name resolution: portable Node filesystem APIs do not expose it. The held directory descriptor pins an identity for comparison, not path traversal. Pre/post lstat and realpath checks detect ordinary persistent replacement, but cannot eliminate malicious mutable-parent TOCTOU/ABA races. A hostile writer can swap a parent out and back between observations. This threat is excluded only by the mandatory infrastructure contract, never by a claim that these checks make an untrusted directory safe. Supporting mutable/untrusted ancestors would require a separately reviewed native anchored primitive; there is no unsafe fallback marketed as equivalent.

Directory timestamps are deliberately not pinned: legitimate publisher additions and unrelated ancestor activity change them. Directory device/inode/type/mode/uid/gid remain pinned. Concurrent reader.close() and reads are unsupported; stop reads before closing. A returned Buffer is a private byte snapshot; callers can mutate their own snapshot but cannot mutate the file through it.

## Publication contract (not implemented or deployed)

1. Obtain the authoritative immutable job identity and finish the frozen ExportEVM export and verification before publication. File contents cannot approve their own lookup identity.
2. Write complete output to an exclusively created temporary sibling (unpredictable temporary name, not the final identity name) on the same local filesystem. Enforce the consumer/decoder byte and leaf ceilings. Fsync the completed contents and close the writer before publication; set consumer-readable, non-consumer-writable permissions before publication.
3. Publish exactly once by atomic rename into an **absent** final identity name, then fsync the containing directory. Publisher serialization/ownership or a supported atomic no-replace rename must enforce absence. Plain POSIX rename can overwrite: a racy exists-then-rename check is NOT a no-replace guarantee. Never overwrite/rewrite a final artifact, including after a crash. Existing identity means reconcile with the durable approved publication, not replace it.
4. Retain immutable final artifacts across consumer restart. Crash before rename leaves ignored temporary files; crash after rename but before directory fsync may lose the name, so the reader must treat missing files as unavailable, not infer completion. A future publisher recovery procedure must preserve immutability. No such publisher is wired here.

A stable partial file wrongly created under its final name cannot be distinguished from a stable complete file by filesystem metadata. That violates the publisher contract: acquisition returns opaque bytes, not a completeness/authenticity assertion. The strict decoder and authoritative identity/suffix validation must reject incomplete or incorrect payloads. Even syntactically valid JSON alone does not prove approved publication.

## Read and failure semantics

Each read derives the one filename from authoritative identity, checks pinned directory/ancestor identities and rejects symlink components. It lstats the final name, requires a positive bounded regular single-link file, opens readonly with NOFOLLOW/NONBLOCK (including FIFO-swap hang protection), and fstats before allocation. Device/inode/mode/uid/gid/size/link count/mtimeNs/ctimeNs must agree with the pre-open observation. It then reads exactly the bounded size, checks EOF with one extra byte, compares descriptor metadata again, lstats the final path for matching identity/metadata, and rechecks directory/ancestor identities. Access time is excluded because reading may update it.

Missing files, temporary-only publication, symlinks, hardlinks, nonregular files, zero bytes, oversize, truncation, growth, observed rewrite or replacement all throw; the caller must yield no plan. No cached artifact or alternate path is returned on errors. Short descriptor reads loop within the original allocation; early EOF fails. Each read allocates at most the requested budget (hard ceiling 16 MiB) plus one EOF byte for file data. Caller concurrency must itself be bounded; the ceiling is per acquisition, not an aggregate worker memory guarantee. Filesystem/kernel I/O latency is not given a timeout guarantee.

After successful acquisition the caller must strictly decode and authenticate the bytes against authoritative job/release/VK/input/binding/member data and pinned canonical state. No producer field, proof validity, JSON schema or leaf count is parsed here. There is no consumer last-read cursor or persistent filename cache; restart reacquires immutable bytes and chain state. Stable replacement **between separate reads or restarts** is forbidden by the infrastructure contract and cannot be detected without trusted persistent publication evidence; no such evidence is invented here.

## Local verification

Tests use temporary fixtures only, including a test-only fsync/rename publication helper and deterministic descriptor-read interception to exercise truncation, growth, same-size mutation and final-name replacement. They do not claim malicious ancestor-race safety or genuine approved job proof. Run: `bun test src/proofArtifactFile.test.ts` from `apps/battle-keeper`.


## Runtime stat precision

Bun 1.1.42 returns numeric descriptor stats despite FileHandle.stat({bigint:true}),
without mtimeNs/ctimeNs; path lstat does return BigIntStats. Bun 1.4 honors the
option for both. Reader identity/size/link comparisons therefore accept bigint
or **safe integer** numbers only, converting the latter exactly and rejecting
unsafe/fractional/nonfinite numbers. This is not loose numeric equality.

Descriptor timestamps retain exact nanoseconds when supplied; legacy descriptor
millisecond numbers are compared to the matching timespec projection without
a tolerance. Crucially, the complete before/final path metadata is also compared
at full bigint nanosecond precision, and missing path nanoseconds fail closed.
Thus a sub-millisecond change cannot hide behind a legacy descriptor projection.
All existing directory/ancestor pinning, NOFOLLOW/NONBLOCK, regular single-link,
bounded allocation/exact EOF, descriptor pre/post and final path checks remain.
The explicit trusted immutable-parent contract remains required; neither this
compatibility handling nor pathname checks claim protection against hostile
mutable-parent ABA races. No runtime pin or filesystem policy is changed.
