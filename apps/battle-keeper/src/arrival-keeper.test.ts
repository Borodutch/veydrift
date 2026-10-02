import { expect, test } from "bun:test";
import { encodeAbiParameters, encodeFunctionData, encodeFunctionResult, keccak256, parseTransaction, stringToHex, toHex, type Hex } from "viem";
import { BattleKeeper } from "./keeper";
import { KeeperJournal } from "./journal";
import { ViemMissionResolver } from "./resolver";
import { progressAbi } from "./progress";
import type { JsonRpcTransport } from "./transport";
const game = "0x1111111111111111111111111111111111111111";
for (const type of [0,1,4]) test("keeper pays successive ordering-only chunks for mission type " + type, async () => {
  let scan = 0n, advance = true, nonce = 0;
  let mined: Hex | undefined;
  const raws: Hex[] = [];
  const blockHash = toHex(1n, {size:32});
  const slot = keccak256(encodeAbiParameters([{type:"uint256"},{type:"bytes32"}], [2n,keccak256(stringToHex("veydrift.storage.arrival-progress.v1"))]));
  const stagedData = encodeFunctionData({ abi:progressAbi,functionName:"stagedBattleProgress",args:[1n] });
  const transport: JsonRpcTransport = { async request<T>(method: string, params: unknown[]): Promise<T> {
    if (method === "eth_getBlockByNumber") return {number:"0x64",hash:blockHash,baseFeePerGas:"0x1"} as T;
    if (method === "eth_getCode") return "0x6000" as T;
    if (method === "eth_getStorageAt") return toHex(params[1] === toHex(BigInt(slot)+1n,{size:32}) ? scan : 0n,{size:32}) as T;
    if (method === "eth_call" && (params[0] as {data:string}).data.startsWith("0xce02abe2")) return ("0x" + [1n,0n,1n].map(n=>n.toString(16).padStart(64,"0")).join("")) as T;
    if (method === "eth_call") return ((params[0] as {data:string}).data === stagedData
      ? encodeFunctionResult({abi:progressAbi,functionName:"stagedBattleProgress",result:[0,0,0n]}) : "0x") as T;
    if (method === "eth_getTransactionCount") return toHex(nonce) as T;
    if (method === "eth_estimateGas") return "0x5208" as T;
    if (method === "eth_maxPriorityFeePerGas") return "0x1" as T;
    if (method === "eth_sendRawTransaction") {
      const raw = params[0] as Hex; raws.push(raw); mined = keccak256(raw); nonce++;
      if (advance) scan += 12n;
      return mined as T;
    }
    if (method === "eth_getTransactionReceipt") return (mined === params[0]
      ? {status:"0x1",transactionHash:mined,blockHash,blockNumber:"0x64"} : null) as T;
    throw new Error(method);
  } };
  const journal = new KeeperJournal(":memory:", "8453:game");
  const make = () => {
    const resolver = new ViemMissionResolver(transport,("0x"+"1".repeat(64)) as Hex,game,8453,
      {arrivalProgressVersions:[game+":"+keccak256("0x6000")],receiptPollIntervalMs:0,receiptMaxPolls:2});
    resolver.missionStatus = async missionId => ({missionId,status:1,missionType:type,targetPlanetId:"2",arrivalAt:1,returnAt:2,randomnessRequestId:"1"});
    return new BattleKeeper(resolver,{journal,now:()=>1000,logger:{info(){},warn(){},error(){}}});
  };
  try {
    let keeper = make(); keeper.recordLaunched({missionId:"1",missionType:type,arrivalAt:1,returnAt:2});
    await keeper.tick(); await keeper.tick(); await keeper.tick();
    expect(raws).toHaveLength(3); expect(raws.map(raw => parseTransaction(raw).nonce)).toEqual([0,1,2]);
    expect(raws.every(raw => parseTransaction(raw).gas === 15_000_000n)).toBe(true);
    advance = false; await keeper.tick(); expect(raws).toHaveLength(4);
    keeper = make(); await keeper.tick(); expect(raws).toHaveLength(4);
  } finally { journal.close(); }
});
