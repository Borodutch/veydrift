import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, normalize, sep } from "node:path";
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

/** Hard acquisition ceiling, independent of any stricter decoder budget. */
export const MAX_PROOF_ARTIFACT_BYTES = 16 * 1024 * 1024;
export interface ProofArtifactIdentity {
  chainId: string;
  battleId: string;
  game: string;
  binding: string;
  releaseId: string;
}

function uint256(value: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value)) {
    throw new Error("artifact identity requires canonical uint256 decimal");
  }
  const result = BigInt(value);
  if (result >= 1n << 256n) throw new Error("artifact identity uint256 overflow");
  return result;
}

/** No caller-supplied filename, URL, or artifact field participates in lookup. */
export function proofArtifactBasename(identity: ProofArtifactIdentity): string {
  const chain = uint256(identity.chainId), battle = uint256(identity.battleId);
  if (typeof identity.game !== "string" || !/^0x[0-9a-f]{40}$/.test(identity.game)) {
    throw new Error("artifact game must be lowercase 20-byte hex");
  }
  for (const value of [identity.binding, identity.releaseId]) {
    if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)) {
      throw new Error("artifact binding/release must be lowercase 32-byte hex");
    }
  }
  const digest = keccak256(encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }],
    [chain, identity.game as Address, battle, identity.binding as Hex, identity.releaseId as Hex],
  ));
  return digest.slice(2) + ".evm.json";
}

function sameInode(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid && a.gid === b.gid;
}
function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return sameInode(a, b) && a.size === b.size && a.nlink === b.nlink &&
    a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
function checkFile(stat: BigIntStats, maxBytes: number): void {
  if (!stat.isFile() || stat.nlink !== 1n) throw new Error("artifact must be a regular single-link file");
  if (stat.size <= 0n || stat.size > BigInt(maxBytes)) throw new Error("artifact file size exceeds byte budget or is empty");
}

async function directoryChain(directory: string): Promise<Array<{ path: string; stat: BigIntStats }>> {
  const paths: string[] = [sep];
  let current: string = sep;
  for (const component of directory.slice(1).split(sep)) {
    current = join(current, component);
    paths.push(current);
  }
  const result = [];
  for (const path of paths) {
    const stat = await lstat(path, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("artifact directory components must not be symlinks");
    result.push({ path, stat });
  }
  return result;
}

/**
 * Explicit infrastructure trust assertion, NOT a runtime verification of ACLs.
 * This module has no production directory/config wiring. A future reviewed owner
 * must supply ONE fixed canonical directory at startup, never a job/producer path.
 * See PROOF_ARTIFACT_FILES.md for the immutable-parent and publication contract.
 */
export interface TrustedProofArtifactDirectory {
  directory: string;
  trust: "fixed-readonly-consumer-directory-and-immutable-ancestors";
}

export function openProofArtifactDirectory(source: TrustedProofArtifactDirectory, maxBytes = MAX_PROOF_ARTIFACT_BYTES) {
  return openProofDirectory(source, maxBytes, ".evm.json");
}
/** Same bounded immutable-parent contract, fixed metadata suffix; never arbitrary paths. */
export function openProofAuthorityDirectory(source: TrustedProofArtifactDirectory, maxBytes = 16 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 16 * 1024)
    throw new Error("invalid authority byte budget");
  return openProofDirectory(source, maxBytes, ".authority.json");
}
async function openProofDirectory(
  source: TrustedProofArtifactDirectory, maxBytes: number, suffix: ".evm.json" | ".authority.json",
): Promise<{ read(identity: ProofArtifactIdentity): Promise<Buffer>; close(): Promise<void> }> {
  const directory = source.directory;
  if (source.trust !== "fixed-readonly-consumer-directory-and-immutable-ancestors") {
    throw new Error("artifact directory infrastructure trust contract required");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_PROOF_ARTIFACT_BYTES) {
    throw new Error("invalid artifact byte budget");
  }
  if (typeof directory !== "string" || !isAbsolute(directory) || directory === sep ||
      normalize(directory) !== directory || directory.endsWith(sep) || directory.includes("\0")) {
    throw new Error("artifact directory must be an exact canonical absolute path");
  }
  if ((process.platform !== "linux" && process.platform !== "darwin") ||
      !constants.O_NOFOLLOW || !constants.O_DIRECTORY || !constants.O_NONBLOCK) {
    throw new Error("artifact nofollow filesystem primitives unavailable");
  }
  const parents = await directoryChain(directory);
  if (await realpath(directory) !== directory) throw new Error("artifact directory is not canonical");
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let closed = false;
  const pinned = await handle.stat({ bigint: true }).catch(async error => { await handle.close(); throw error; });
  async function assertDirectory(): Promise<void> {
    if (closed) throw new Error("artifact directory reader is closed");
    if (!pinned.isDirectory() || !sameInode(pinned, parents[parents.length - 1]!.stat) ||
        !sameInode(pinned, await handle.stat({ bigint: true }))) {
      throw new Error("artifact directory identity changed");
    }
    for (const parent of parents) {
      const now = await lstat(parent.path, { bigint: true });
      if (!now.isDirectory() || now.isSymbolicLink() || !sameInode(parent.stat, now)) {
        throw new Error("artifact directory identity changed");
      }
    }
    if (await realpath(directory) !== directory) throw new Error("artifact directory is not canonical");
  }
  try { await assertDirectory(); } catch (error) { await handle.close(); throw error; }
  return {
    async read(identity) {
      const basename = proofArtifactBasename(identity).slice(0, -9) + suffix;
      await assertDirectory();
      // Node has no portable openat(dirfd, basename, O_NOFOLLOW). These path
      // checks are diagnostic under the explicit immutable-parent contract;
      // they DO NOT close a malicious mutable-parent TOCTOU/ABA race.
      const path = join(directory, basename);
      const before = await lstat(path, { bigint: true });
      checkFile(before, maxBytes);
      let file: FileHandle | undefined;
      try {
        // NONBLOCK prevents a regular-file -> FIFO swap from hanging open.
        file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const start = await file.stat({ bigint: true });
        checkFile(start, maxBytes);
        if (!sameFile(before, start)) throw new Error("artifact changed before open");
        await assertDirectory();
        const bytes = Buffer.alloc(Number(start.size));
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
          if (!bytesRead) throw new Error("artifact truncated during read");
          offset += bytesRead;
        }
        const eof = Buffer.alloc(1);
        if ((await file.read(eof, 0, 1, offset)).bytesRead !== 0) throw new Error("artifact grew during read");
        const after = await file.stat({ bigint: true });
        checkFile(after, maxBytes);
        if (!sameFile(start, after)) throw new Error("artifact changed during read");
        const final = await lstat(path, { bigint: true });
        checkFile(final, maxBytes);
        if (!sameFile(after, final)) throw new Error("artifact path changed during read");
        await assertDirectory();
        return bytes;
      } finally {
        await file?.close();
      }
    },
    async close() {
      if (!closed) { closed = true; await handle.close(); }
    },
  };
}
