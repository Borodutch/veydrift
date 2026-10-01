import { expect, test } from "bun:test";
import { encodeAbiParameters, encodeFunctionResult, keccak256, stringToHex, toHex, type Hex } from "viem";
import { readMissionProgress, progressAbi, consumeProgress, guardAllows, progressKey } from "./progress";
const hash = "0x" + "a".repeat(64);
const address = "0x1111111111111111111111111111111111111111";
const slot = (base: bigint) => keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [2n, base]));
const base = BigInt(slot(BigInt(keccak256(stringToHex("veydrift.storage.arrival-progress.v1")))));
function fixture() {
  let generation = 1n, scanWork = 20n, cursor = 20n, phase = 15, work = 7n;
  let invalid = false;
  const tags: unknown[] = [];
  const read = (versions = [`${address}:${keccak256("0x6000")}`]) => readMissionProgress({ async request<T>(method: string, params: unknown[]): Promise<T> {
    if (method === "eth_getBlockByNumber") return { number: "0x64", hash } as T;
    tags.push(params[params.length - 1]);
    if (method === "eth_getCode") return "0x6000" as T;
    if (method === "eth_call") return encodeFunctionResult({ abi: progressAbi, functionName: "stagedBattleProgress", result: [phase, 0, work] }) as T;
    if (method === "eth_getStorageAt") {
      if (params[1] === toHex(base, { size: 32 })) return (invalid ? "0x" : toHex(generation, { size: 32 })) as T;
      if (params[1] === toHex(base + 1n, { size: 32 })) return toHex(scanWork, { size: 32 }) as T;
      return toHex(params[1] === slot(74n) ? cursor : 0n, { size: 32 }) as T;
    }
    throw new Error(method);
  } }, address, "1", "2", false, versions);
  return { read, tags, reset() { generation++; cursor = 0n; }, scan() { cursor++; scanWork++; },
    finishProtection() { phase = 1; work++; }, legacy() { generation = 0n; scanWork = 0n; },
    legacyReset() { cursor = 0n; }, corrupt() { invalid = true; }, regress() { generation--; scanWork--; } };
}
test("launch/recall resets raw index but namespace remains monotonic; same-hash EIP1898 reads", async () => {
  const f = fixture();
  const before = await f.read();
  expect(before.arrivalOrderCursor).toBeUndefined();
  let guard = consumeProgress(undefined, before, "1", "arrival");
  for (const operation of ["launch", "recall"]) {
    f.reset(); const reset = await f.read();
    expect(guardAllows(guard, reset)).toBe(true);
    guard = consumeProgress(guard, reset, "1", "arrival");
    expect(guardAllows(guard, reset)).toBe(false);
    f.scan(); const scanned = await f.read();
    expect(guardAllows(guard, scanned)).toBe(true);
    guard = consumeProgress(guard, scanned, "1", "arrival");
  }
  f.regress(); expect(guardAllows(guard, await f.read())).toBe(false);
  expect(f.tags.every(tag => JSON.stringify(tag) === JSON.stringify({ blockHash: hash, requireCanonical: true }))).toBe(true);
});
test("phase15 to1 with cumulative serial advances while phase-only changes do not", async () => {
  const f = fixture(), before = await f.read();
  const guard = consumeProgress(undefined, before, "1", "arrival");
  expect(guardAllows(guard, { ...before, phase: 1 })).toBe(false);
  f.finishProtection(); expect(guardAllows(guard, await f.read())).toBe(true);
});
test("only valid zero namespace falls back; first activity migrates cursor, never falls back again", async () => {
  const f = fixture(); f.legacy(); const legacy = await f.read([]);
  expect(legacy.arrivalOrderCursor).toBe("20");
  const oldGuard = consumeProgress(undefined, legacy, "1", "arrival");
  f.reset(); const active = await f.read();
  expect(guardAllows(oldGuard, active)).toBe(true);
  const guard = consumeProgress(oldGuard, active, "1", "arrival");
  f.legacy(); expect(guardAllows(guard, await f.read([]))).toBe(false);
  f.corrupt(); await expect(f.read()).rejects.toThrow("invalid arrival progress");
});

test("truly legacy zero namespace never authorizes a launch/recall cursor reset or initial paid probe", async () => {
  const f = fixture(); f.legacy();
  const before = await f.read([]);
  expect(guardAllows(undefined, before)).toBe(false);
  const guard = consumeProgress(undefined, before, "1", "arrival");
  f.legacyReset(); const after = await f.read([]);
  expect(after.arrivalOrderCursor).toBe("0");
  expect(after.arrivalGeneration).toBeUndefined();
  expect(guardAllows(guard, after)).toBe(false);
  expect(guardAllows(undefined, after)).toBe(false);
});


test("verified implementation/runtime permits one durable zero-counter bootstrap; unknown code never does", async () => {
  const f = fixture(); f.legacy();
  const current = await f.read();
  expect(current.arrivalGeneration).toBe("0"); expect(current.arrivalWorkDone).toBe("0");
  expect(current.arrivalOrderCursor).toBeUndefined(); expect(current.arrivalCapability).toBe(true);
  expect(guardAllows(undefined, current)).toBe(true);
  const guard = consumeProgress(undefined, current, "1", "arrival");
  expect(guardAllows(guard, current)).toBe(false);
  f.scan(); expect(guardAllows(guard, await f.read())).toBe(true);
  expect(guardAllows(undefined, await f.read([]))).toBe(false); // Nonzero storage is not code provenance.
  expect(guardAllows(undefined, await f.read([address + ":" + keccak256("0x6001")]))).toBe(false);
  expect(guardAllows(undefined, await f.read(["0x2222222222222222222222222222222222222222:" + keccak256("0x6000")]))).toBe(false);
});


test("capability binds EIP1967 implementation and exact runtime hash at the same canonical block", async () => {
  const impl = "0x2222222222222222222222222222222222222222";
  const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  let code: Hex = "0x6000";
  const tags: unknown[] = [];
  const transport = { async request<T>(method:string,params:unknown[]):Promise<T> {
    if(method === "eth_getBlockByNumber") return {number:"0x64",hash} as T;
    tags.push(params.at(-1));
    if(method === "eth_getStorageAt") return toHex(params[1]===implementationSlot?BigInt(impl):0n,{size:32}) as T;
    if(method === "eth_getCode") { expect(params[0]).toBe(impl); return code as T; }
    return encodeFunctionResult({abi:progressAbi,functionName:"stagedBattleProgress",result:[0,0,0n]}) as T;
  } };
  const versions = [impl+":"+keccak256("0x6000")];
  const read = () => readMissionProgress(transport,address,"1","2",false,versions);
  expect(guardAllows(undefined,await read())).toBe(true);
  code = "0x6001"; expect(guardAllows(undefined,await read())).toBe(false);
  expect(tags.every(tag=>JSON.stringify(tag)===JSON.stringify({blockHash:hash,requireCanonical:true}))).toBe(true);
});

for (const target of [undefined, "2"]) test("chronology counter keeps " + (target ? "arrival" : "return") + " scans live without reopening paid no-ops", async () => {
  let work = 0n;
  const chronologySlot = keccak256(encodeAbiParameters([{type:"uint256"},{type:"uint256"}],
    [1n, BigInt(keccak256(stringToHex("veydrift.storage.arrival-progress.v1"))) + 1n]));
  const tags: unknown[] = [];
  const read = () => readMissionProgress({async request<T>(method: string, params: unknown[]): Promise<T> {
    if (method === "eth_getBlockByNumber") return {number:"0x64",hash} as T;
    tags.push(params.at(-1));
    if (method === "eth_getCode") return "0x6000" as T;
    if (method === "eth_getStorageAt") return toHex(params[1] === chronologySlot ? work : 0n,{size:32}) as T;
    if (method === "eth_call") return encodeFunctionResult({abi:progressAbi,functionName:"stagedBattleProgress",result:[0,0,0n]}) as T;
    throw new Error(method);
  }}, address, "1", target, false, [address+":"+keccak256("0x6000")]);
  const before = await read(); expect(before.chronologyWorkDone).toBe("0");
  const guard = consumeProgress(undefined,before,"1",target ? "arrival" : "return");
  expect(guardAllows(guard,await read())).toBe(false);
  work=12n; const advanced=await read(); expect(guardAllows(guard,advanced)).toBe(true);
  const paid=consumeProgress(guard,advanced,"1",target ? "arrival" : "return");
  expect(guardAllows(paid,await read())).toBe(false);
  work=1n; expect(guardAllows(paid,await read())).toBe(false);
  expect(tags.every(tag=>JSON.stringify(tag)===JSON.stringify({blockHash:hash,requireCanonical:true}))).toBe(true);
});
test("chronology extension preserves pre-existing raw envelope operation keys", () => {
  const old={blockNumber:"1",blockHash:hash,version:"v",phase:0,round:0,workDone:"0"};
  expect(progressKey(old)).toBe(["v","0","0","","","",""].join(":"));
  expect(progressKey({...old,chronologyWorkDone:"0"})).toBe(progressKey(old)+":chronology:0");
});
