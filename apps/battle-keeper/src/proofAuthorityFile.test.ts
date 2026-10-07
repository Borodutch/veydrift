import { expect, test } from "bun:test";
import { mkdtemp, realpath, mkdir, writeFile, rm, symlink, link, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeAbiParameters, keccak256, parseAbiParameters, type Hex } from "viem";
import { readFileSync } from "node:fs";
import { proofArtifactBasename, openProofAuthorityDirectory } from "./proofArtifactFile";
import { parseProofAuthority, openProofAuthorityResolver } from "./proofAuthorityFile";
import type { CanonicalProofJob } from "./proofAcceptance";
const hex = (s: string) => "0x" + s.repeat(64) as Hex;
// Synthetic all-string record traced to publisher/authority_test.go, NOT a verified proof.
function fixture() {
  const record = { schema: "veydrift.proof-artifact-authority.v1", chainId: "8453", game: "0x0000000000000000000000000000000000000001" as Hex,
    battleId: "100", binding: hex("1"), releaseId: hex("2"), vkHash: "3".repeat(64), inputHash: "4".repeat(64),
    compressedProofHash: "5".repeat(64), exportSha256: "6".repeat(64), catalogSha256: "7".repeat(64),
    jobKey: "8".repeat(64), jobGeneration: "9".repeat(64), jobAnchorNumber: "1", jobAnchorHash: "a".repeat(64),
    artifactBlobSha256: "b".repeat(64), publisherConfigSha256: "c".repeat(64) };
  const job = { chainId: 8453n, battleId: 100n, game: record.game as Hex, binding: record.binding, releaseId: record.releaseId } as CanonicalProofJob;
  const pins = { catalogSha256: record.catalogSha256, publisherConfigSha256: record.publisherConfigSha256 };
  return { record, job, pins };
}
test("authority exact Go-shaped strings map only planner fields, not provenance or release approval", () => {
  const f = fixture(); const a = parseProofAuthority(JSON.stringify(f.record), f.job, f.pins);
  expect(a).toEqual({ chainId: 8453n, battleId: 100n, game: f.record.game, binding: f.record.binding,
    releaseId: f.record.releaseId, vkHash: f.record.vkHash, inputHash: f.record.inputHash,
    compressedProofHash: f.record.compressedProofHash, exportSha256: f.record.exportSha256 });
  expect(Object.isFrozen(a)).toBe(true);
  f.record.jobAnchorNumber = "18446744073709551615";
  expect(() => parseProofAuthority(JSON.stringify(f.record), f.job, f.pins)).not.toThrow();
});
test("authority rejects noncanonical or incomplete JSON and every mismatched trusted identity/pin", () => {
  const { record: r, job, pins } = fixture(); const good = JSON.stringify(r);
  for (const bad of [good + "\n", "\ufeff" + good, good.slice(0,-1), "[]", "null", good.replace('"chainId":', '"chainId":"8453","chainId":'),
    JSON.stringify(Object.fromEntries(Object.entries(r).reverse())), good.replace("schema", "sc\\u0068ema"), JSON.stringify({...r, extra:"x"}), " ".repeat(16385)]) {
    expect(() => parseProofAuthority(bad, job, pins)).toThrow();
  }
  for (const key of Object.keys(r)) {
    const removed = {...r} as Record<string, unknown>; delete removed[key];
    expect(() => parseProofAuthority(JSON.stringify(removed), job, pins)).toThrow();
    expect(() => parseProofAuthority(JSON.stringify({...r,[key]:1}), job, pins)).toThrow();
  }
  for (const [key, value] of Object.entries({schema:"wrong",chainId:"1",game:"0x"+"2".repeat(40),battleId:"1",binding:hex("3"),releaseId:hex("3"),catalogSha256:"e".repeat(64),publisherConfigSha256:"e".repeat(64)}))
    expect(() => parseProofAuthority(JSON.stringify({...r,[key]:value}), job, pins)).toThrow();
  for (const [key, value] of Object.entries({chainId:"0",battleId:"01",game:"0x"+"0".repeat(40),binding:"0x"+"A".repeat(64),releaseId:"2".repeat(64),jobAnchorNumber:"18446744073709551616",jobAnchorHash:"0x"+"a".repeat(64)}))
    expect(() => parseProofAuthority(JSON.stringify({...r,[key]:value}), job, pins)).toThrow();
  for (const key of ["vkHash","inputHash","compressedProofHash","exportSha256","catalogSha256","jobKey","jobGeneration","jobAnchorHash","artifactBlobSha256","publisherConfigSha256"])
    expect(() => parseProofAuthority(JSON.stringify({...r,[key]:"A".repeat(64)}), job, pins)).toThrow();
  expect(() => parseProofAuthority(good, job, {...pins,publisherConfigSha256:""})).toThrow();
});
test("filename input independently calculated with viem; producer Go/ethers cross-check remains separate", () => {
  const v = JSON.parse(readFileSync(new URL("../../../packages/battle-prover/publisher/testdata/filename-vector.json", import.meta.url), "utf8"));
  const r=v.release;
  const releaseId = keccak256(encodeAbiParameters(parseAbiParameters("uint32,bytes32,bytes32,address,bytes32"),
    [Number(r.version), "0x"+r.rules as Hex, "0x"+r.catalog as Hex, r.verifier, "0x"+r.verifierCodehash as Hex]));
  expect(releaseId).toBe("0x5e9b91bfed181a6f776c1007673cb4204a49222b6d31b9a692c7b103cfdacc2e");
  expect(proofArtifactBasename({...v,releaseId})).toBe("3a814dbb9f06f663789f320ab0d37620a729bf174baa251f83e0f4200b43d643.evm.json");
  // Null is a producer validation gate, NEVER an expected field/hash assumption.
  if (v.expectedReleaseId !== null) expect(releaseId).toBe(v.expectedReleaseId);
  if (v.expectedBasename !== null) expect(proofArtifactBasename({...v,releaseId})).toBe(v.expectedBasename + ".evm.json");
});
test("authority fixed separate root fails closed for absent, partial, links, oversized and changed records", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "authority-reader-")));
  const trust = "fixed-readonly-consumer-directory-and-immutable-ancestors" as const;
  const source = {directory:join(root,"authority"),trust}, artifactSource = {directory:join(root,"artifacts"),trust};
  await mkdir(source.directory); await mkdir(artifactSource.directory);
  const f=fixture(); const options={source,artifactSource,pins:{...f.pins}};
  let resolver=await openProofAuthorityResolver(options);
  const name=proofArtifactBasename(f.record).replace(".evm.json",".authority.json"), path=join(source.directory,name);
  try {
    await expect(resolver.resolve(f.job)).rejects.toThrow();
    await writeFile(join(source.directory,"unfinished.tmp"),JSON.stringify(f.record));
    await expect(resolver.resolve(f.job)).rejects.toThrow();
    await writeFile(join(artifactSource.directory,name),JSON.stringify(f.record));
    await expect(resolver.resolve(f.job)).rejects.toThrow();
    await rename(join(source.directory,"unfinished.tmp"),path);
    options.pins.publisherConfigSha256="d".repeat(64); // constructor snapshots approved pins
    expect((await resolver.resolve(f.job)).exportSha256).toBe(f.record.exportSha256);
    await resolver.close(); await expect(resolver.resolve(f.job)).rejects.toThrow("closed");
    resolver=await openProofAuthorityResolver({...options,pins:f.pins});
    expect((await resolver.resolve(f.job)).vkHash).toBe(f.record.vkHash);
    for (const bad of [Buffer.from([0xff]),Buffer.from([0xef,0xbb,0xbf,...Buffer.from(JSON.stringify(f.record))]),Buffer.from(JSON.stringify(f.record).slice(0,-1)),Buffer.alloc(16385)]) {
      await writeFile(path,bad); await expect(resolver.resolve(f.job)).rejects.toThrow();
    }
    await rm(path); await symlink(join(artifactSource.directory,name),path);
    await expect(resolver.resolve(f.job)).rejects.toThrow(); await rm(path);
    await link(join(artifactSource.directory,name),path);
    await expect(resolver.resolve(f.job)).rejects.toThrow(); await rm(path);
    await writeFile(path,JSON.stringify({...f.record,publisherConfigSha256:"d".repeat(64)}));
    await expect(resolver.resolve(f.job)).rejects.toThrow("pin mismatch");
    await expect(openProofAuthorityResolver({...options,artifactSource:source})).rejects.toThrow("disjoint");
    await expect(openProofAuthorityResolver({...options,artifactSource:{directory:root,trust}})).rejects.toThrow("disjoint");
    expect(() => openProofAuthorityDirectory(source,16385)).toThrow("budget");
    await rename(source.directory,source.directory+"-old"); await mkdir(source.directory);
    await writeFile(path,JSON.stringify(f.record)); await expect(resolver.resolve(f.job)).rejects.toThrow("identity changed");
  } finally { await resolver.close(); await rm(root,{recursive:true,force:true}); }
});
