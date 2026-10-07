import { afterEach, expect, spyOn, test } from "bun:test";
import { link, mkdir, mkdtemp, open, realpath, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, type Hex } from "viem";
import { MAX_PROOF_ARTIFACT_BYTES, openProofArtifactDirectory, proofArtifactBasename, type ProofArtifactIdentity } from "./proofArtifactFile";

const identity: ProofArtifactIdentity = {
  chainId: "8453", battleId: "42", game: "0x" + "12".repeat(20),
  binding: "0x" + "34".repeat(32), releaseId: "0x" + "56".repeat(32),
};
const trust = "fixed-readonly-consumer-directory-and-immutable-ancestors" as const;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
async function fixture(maxBytes = 1024) {
  // macOS /var and /tmp are symlinks: fixture root must itself be canonical.
  const root = await mkdtemp(join(await realpath(tmpdir()), "proof-file-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "approved");
  await mkdir(directory);
  const reader = await openProofArtifactDirectory({ directory, trust }, maxBytes);
  cleanups.push(() => reader.close());
  return { root, directory, reader, path: join(directory, proofArtifactBasename(identity)) };
}
async function publish(path: string, content: string) {
  const temporary = path + ".partial";
  const writer = await open(temporary, "wx", 0o600);
  try { await writer.writeFile(content); await writer.sync(); } finally { await writer.close(); }
  // Fixture has one publisher and an absent target. Production requires the
  // no-replacement ownership contract, not a racy exists-then-rename check.
  await rename(temporary, path);
  const directory = await open(join(path, ".."), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

test("exact bounded basename hashes five ABI words, with every identity field bound", () => {
  const words = [8453n, BigInt(identity.game), 42n, BigInt(identity.binding), BigInt(identity.releaseId)];
  const encoded = ("0x" + words.map(n => n.toString(16).padStart(64, "0")).join("")) as Hex;
  const name = proofArtifactBasename(identity);
  expect(name).toBe(keccak256(encoded).slice(2) + ".evm.json");
  expect(name).toMatch(/^[0-9a-f]{64}\.evm\.json$/);
  expect(name.length).toBe(73);
  for (const [key, value] of Object.entries({ chainId: "8454", battleId: "43", game: "0x" + "13".repeat(20), binding: "0x" + "35".repeat(32), releaseId: "0x" + "57".repeat(32) })) {
    expect(proofArtifactBasename({ ...identity, [key]: value })).not.toBe(name);
  }
  expect(proofArtifactBasename({ ...identity, chainId: ((1n << 256n) - 1n).toString(), battleId: ((1n << 256n) - 1n).toString() })).toHaveLength(73);
});

test("reject traversal, URLs, decimal aliases, overflow and noncanonical hex", () => {
  for (const value of ["../42", "https://example/42", "file:///42", "042", "-1", "1e3", " 42", "42\n", (1n << 256n).toString()]) {
    expect(() => proofArtifactBasename({ ...identity, battleId: value })).toThrow();
    expect(() => proofArtifactBasename({ ...identity, chainId: value })).toThrow();
  }
  for (const key of ["game", "binding", "releaseId"] as const) {
    for (const value of ["../escape", "https://example/file", "0xAA", identity[key] + "0", identity[key] + "\n"]) {
      expect(() => proofArtifactBasename({ ...identity, [key]: value })).toThrow();
    }
  }
});

test("atomic publication, restart, exact EOF and no artifact parsing or byte mutation", async () => {
  const f = await fixture(7);
  await writeFile(f.path + ".partial", "{");
  await expect(f.reader.read(identity)).rejects.toThrow();
  await rm(f.path + ".partial");
  await publish(f.path, "rawdata");
  expect((await f.reader.read(identity)).toString()).toBe("rawdata");
  await f.reader.close();
  await expect(f.reader.read(identity)).rejects.toThrow("closed");
  const restart = await openProofArtifactDirectory({ directory: f.directory, trust }, 7);
  try { expect((await restart.read(identity)).toString()).toBe("rawdata"); } finally { await restart.close(); }
});

test("missing, empty, oversized and sparse files reject before buffer allocation", async () => {
  const f = await fixture(8);
  await expect(f.reader.read(identity)).rejects.toThrow();
  await writeFile(f.path, "");
  await expect(f.reader.read(identity)).rejects.toThrow("size");
  await truncate(f.path, MAX_PROOF_ARTIFACT_BYTES + 1);
  const allocation = spyOn(Buffer, "alloc");
  try {
    await expect(f.reader.read(identity)).rejects.toThrow("budget");
    expect(allocation).not.toHaveBeenCalled();
  } finally { allocation.mockRestore(); }
});

test("reject unbounded budgets, missing trust assertion and arbitrary directory forms", async () => {
  const f = await fixture();
  for (const max of [0, -1, 1.5, Infinity, NaN, MAX_PROOF_ARTIFACT_BYTES + 1]) {
    await expect(openProofArtifactDirectory({ directory: f.directory, trust }, max)).rejects.toThrow("budget");
  }
  await expect(openProofArtifactDirectory({ directory: f.directory, trust: "" as typeof trust })).rejects.toThrow("trust");
  for (const directory of [".", "../approved", "file:///tmp/approved", "https://example/approved", f.directory + "/", f.directory + "/../approved", f.directory + "\0"]) {
    await expect(openProofArtifactDirectory({ directory, trust })).rejects.toThrow();
  }
});

test("reject final symlink, directory and hardlink", async () => {
  const f = await fixture();
  const other = join(f.root, "other");
  await writeFile(other, "payload");
  await symlink(other, f.path);
  await expect(f.reader.read(identity)).rejects.toThrow("regular");
  await rm(f.path);
  await mkdir(f.path);
  await expect(f.reader.read(identity)).rejects.toThrow("regular");
  await rm(f.path, { recursive: true });
  await link(other, f.path);
  await expect(f.reader.read(identity)).rejects.toThrow("single-link");
});

test("reject symlink directory and symlink ancestor", async () => {
  const f = await fixture();
  const alias = join(f.root, "alias");
  await symlink(f.directory, alias);
  await expect(openProofArtifactDirectory({ directory: alias, trust })).rejects.toThrow("symlinks");
  await mkdir(join(f.directory, "nested"));
  await expect(openProofArtifactDirectory({ directory: join(alias, "nested"), trust })).rejects.toThrow("symlinks");
});

test("pin directory across rename/replacement rather than silently following new directory", async () => {
  const f = await fixture();
  await publish(f.path, "old");
  await rename(f.directory, f.directory + "-old");
  await mkdir(f.directory);
  await writeFile(f.path, "new");
  await expect(f.reader.read(identity)).rejects.toThrow("identity changed");
});

// Mutate real temporary files deterministically at the descriptor read boundary;
// no production hooks, module mocks, sleep races, network or host files.
async function duringRead(action: (path: string) => Promise<void>) {
  const f = await fixture();
  await publish(f.path, "original");
  const probe = await open(f.path, "r");
  const proto = Object.getPrototypeOf(probe);
  await probe.close();
  const original = proto.read;
  let mutated = false;
  const intercepted = spyOn(proto, "read").mockImplementation(async function(this: unknown, ...args: unknown[]) {
    if (!mutated) { mutated = true; await action(f.path); }
    return original.apply(this, args);
  });
  try { await expect(f.reader.read(identity)).rejects.toThrow(); expect(mutated).toBe(true); }
  finally { intercepted.mockRestore(); }
}

test("reject truncate during read", async () => { await duringRead(path => truncate(path, 1)); });
test("reject append at EOF", async () => { await duringRead(path => writeFile(path, "original-extra")); });
test("reject same-size rewrite by metadata", async () => { await duringRead(path => writeFile(path, "modified")); });
test("reject final path replacement even when old descriptor remains readable", async () => {
  await duringRead(async path => { await rename(path, path + ".old"); await writeFile(path, "replaced"); });
});


// Exercise the legacy FileHandle.stat shape even when tests run on modern Bun.
async function descriptorStats(action: (f: Awaited<ReturnType<typeof fixture>>, proto: any, original: any) => Promise<void>) {
  const f = await fixture(); await publish(f.path, "original");
  const probe = await open(f.path, "r"), proto = Object.getPrototypeOf(probe);
  await probe.close();
  await action(f, proto, proto.stat);
}
test("safe numeric descriptor stats retain exact identities and readable bytes", async () => {
  await descriptorStats(async (f, proto, original) => {
    const intercepted = spyOn(proto, "stat").mockImplementation(function(this: unknown) { return original.call(this, { bigint: false }); });
    try { expect((await f.reader.read(identity)).toString()).toBe("original"); }
    finally { intercepted.mockRestore(); }
  });
});
test("unsafe numeric descriptor identities sizes and link counts fail closed", async () => {
  await descriptorStats(async (f, proto, original) => {
    for (const key of ["dev", "ino", "mode", "uid", "gid", "size", "nlink"]) {
      const intercepted = spyOn(proto, "stat").mockImplementation(async function(this: unknown) {
        const result = await original.call(this, { bigint: false }); result[key] = Number.MAX_SAFE_INTEGER + 1; return result;
      });
      try { await expect(f.reader.read(identity)).rejects.toThrow("integer precision unavailable"); }
      finally { intercepted.mockRestore(); }
    }
  });
});
test("missing descriptor timestamps never compare equal by undefined", async () => {
  await descriptorStats(async (f, proto, original) => {
    const intercepted = spyOn(proto, "stat").mockImplementation(async function(this: unknown) {
      const result = await original.call(this, { bigint: false }); result.mtimeMs = undefined; return result;
    });
    try { await expect(f.reader.read(identity)).rejects.toThrow("changed before open"); }
    finally { intercepted.mockRestore(); }
  });
});
test("nanosecond-only path changes reject even with unchanged legacy descriptor projections", async () => {
  const fs = await import("node:fs/promises");
  await descriptorStats(async (f, proto, original) => {
    const descriptor = spyOn(proto, "stat").mockImplementation(function(this: unknown) { return original.call(this, { bigint: false }); });
    const originalLstat = fs.lstat;
    let artifactReads = 0;
    const pathStat = spyOn(fs, "lstat").mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      const stat = await originalLstat(...args);
      if (args[0] === f.path && ++artifactReads === 2) {
        const s = stat as import("node:fs").BigIntStats;
        const ms = (ns: bigint) => Number(ns / 1_000_000_000n) * 1000 + Number(ns % 1_000_000_000n) / 1e6;
        const delta = ms(s.mtimeNs + 1n) === ms(s.mtimeNs) ? 1n : -1n;
        expect(ms(s.mtimeNs + delta)).toBe(ms(s.mtimeNs));
        s.mtimeNs += delta;
      }
      return stat;
    }) as typeof fs.lstat);
    try { await expect(f.reader.read(identity)).rejects.toThrow("path changed during read"); expect(artifactReads).toBe(2); }
    finally { pathStat.mockRestore(); descriptor.mockRestore(); }
  });
});
