import { RecoveryReadinessError, RecoveryTrace, acquireRecoveryHead, recoveryCandidateReceipt, assertRecoveryNonce, readOnlyRecoveryPass } from "./recoveryReadiness";
import { createPublicClient, http, encodeAbiParameters, parseAbi, toHex, keccak256, serializeTransaction, parseTransaction, recoverTransactionAddress, TransactionNotFoundError, type TransactionSerialized, type Hex, type PublicClient } from "viem";
import { batchCalldata, type BatchLeg, type MissionBatchPolicy } from "./missionBatch";
import { assertBatchQuoteFresh, validateMissionBatchReplay } from "./missionBatchFees";
import type { LegacyRecoveryBinding, PreparedReconciliationPass, PreparedReplayGuard } from "./resolverTransactions";

export type MissionRecoveryInput = {
  chainId: number; address: Hex; nonce: number; originalHash: Hex; operationId: string;
  membership: string; game: Hex; calldataHash: Hex;
  identities: Array<{ address: Hex; codeHash: Hex }>;
  implementation: Hex;
  originalFee: { gas: string; totalWei: string; l1ReserveWei: string; operatorReserveWei: string;
    maxFeePerGas: string; priority: null; source: string; sourceDigest: Hex };
  gas: string; allowAlreadySettled: boolean;
  recoveryId: string; maxFeeWei: string; referenceRpcUrl: string;
  mission: { owner: Hex; origin: string; target: string; returnAt: string; shipsWords: [Hex,Hex]; bodyFlags: Hex };
};
export const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
const hex32 = /^0x[0-9a-f]{64}$/i, address = /^0x[0-9a-f]{40}$/i, integer = /^(0|[1-9][0-9]*)$/;
function exactKeys(value: unknown, keys: string): void {
  if (!value || typeof value!=="object" || Array.isArray(value)
    || Object.keys(value).sort().join(",")!==keys.split(" ").sort().join(",")) throw new Error("recovery manifest schema mismatch");
}
export function recoveryBinding(input: MissionRecoveryInput): LegacyRecoveryBinding {
  exactKeys(input,"chainId address nonce originalHash operationId membership game calldataHash identities implementation originalFee gas allowAlreadySettled recoveryId maxFeeWei referenceRpcUrl mission");
  exactKeys(input.originalFee,"gas totalWei l1ReserveWei operatorReserveWei maxFeePerGas priority source sourceDigest");
  exactKeys(input.mission,"owner origin target returnAt shipsWords bodyFlags");
  if (Array.isArray(input.identities)) for (const identity of input.identities) exactKeys(identity,"address codeHash");
  if (!Number.isSafeInteger(input.chainId) || ![8453,84532].includes(input.chainId)
    || !Number.isSafeInteger(input.nonce) || input.nonce < 0 || !address.test(input.address)
    || !address.test(input.game) || !address.test(input.implementation) || !hex32.test(input.originalHash)
    || !hex32.test(input.calldataHash) || !Array.isArray(input.identities) || input.identities.length < 3
    || input.identities.length > 16 || input.identities.some((i) => !address.test(i.address) || !hex32.test(i.codeHash))
    || !input.identities.some((i) => i.address.toLowerCase() === input.implementation.toLowerCase())
    || new Set(input.identities.map((i) => i.address.toLowerCase())).size !== input.identities.length
    || typeof input.allowAlreadySettled !== "boolean" || !/^[a-zA-Z0-9_-]{8,80}$/.test(input.recoveryId)
    || !/^[0-9]{1,18}$/.test(input.maxFeeWei) || BigInt(input.maxFeeWei)<=0n || BigInt(input.maxFeeWei)>200_000_000_000_000n) throw new Error("invalid recovery identity input");
  if (!input.mission || !address.test(input.mission.owner) || ![input.mission.origin,input.mission.target,input.mission.returnAt].every(v=>integer.test(v))
    || input.mission.shipsWords?.length!==2 || !input.mission.shipsWords.every(v=>hex32.test(v)) || !hex32.test(input.mission.bodyFlags) || BigInt(input.mission.bodyFlags)!==0n) throw new Error("invalid planet transport asset binding");
  const referenceUrl = new URL(input.referenceRpcUrl);
  if (referenceUrl.protocol!=="https:" || referenceUrl.username || referenceUrl.password || referenceUrl.search || referenceUrl.hash) throw new Error("recovery requires public credential-free HTTPS reference");
  if (typeof input.membership!=="string" || input.membership.length>4096 || input.originalFee?.source.length>512) throw new Error("recovery input too large");
  const items = JSON.parse(input.membership) as BatchLeg[];
  if (!Array.isArray(items) || items.length !== 1 || items.some((i) => !/^[1-9][0-9]*$/.test(i.missionId)
    || i.leg !== "return" || !Number.isSafeInteger(i.dueAt) || i.dueAt <= 0 || i.dueAt.toString()!==input.mission.returnAt)
    || new Set(items.map((i) => i.missionId + ":" + i.leg)).size !== items.length) throw new Error("invalid recovery membership");
  for (const item of items) exactKeys(item,"missionId leg dueAt");
  const data = batchCalldata(items);
  if (keccak256(data) !== input.calldataHash || input.operationId !== "mission-batch:" + input.game.toLowerCase() + ":" + input.calldataHash)
    throw new Error("recovery calldata/operation mismatch");
  const f = input.originalFee;
  if (!f || ![f.gas,f.totalWei,f.l1ReserveWei,f.operatorReserveWei,f.maxFeePerGas,input.gas].every((s) => typeof s === "string" && integer.test(s))
    || !f.source || f.source.length > 512 || !hex32.test(f.sourceDigest) || f.priority !== null
    || BigInt(f.gas) <= 0n || BigInt(f.maxFeePerGas) <= 0n
    || BigInt(f.gas)*BigInt(f.maxFeePerGas)+BigInt(f.l1ReserveWei)+BigInt(f.operatorReserveWei) !== BigInt(f.totalWei)
    || BigInt(input.gas) <= 0n || BigInt(input.gas) > 16_777_216n) throw new Error("invalid original fee bound provenance");
  return { chainId: input.chainId, address: input.address.toLowerCase() as Hex, nonce: input.nonce,
    originalHash: input.originalHash.toLowerCase() as Hex, operationId: input.operationId, membership: input.membership,
    to: input.game.toLowerCase() as Hex, data, value: "0", evidence: JSON.stringify(input) };
}

// Fixed fan-out, not a new RPC budget: every operation still enters pass.read.
// Settle the current wave before returning or starting another. On a pass deadline,
// the coordinator retains any underlying reads and rejects retries until they settle.
async function recoveryReads(operations: Array<() => Promise<void>>): Promise<void> {
  for (let offset = 0; offset < operations.length; offset += 8) {
    const results = await Promise.allSettled(operations.slice(offset, offset + 8).map(operation => operation()));
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
}

export async function verifyRecoveryReference(client: PublicClient, input: MissionRecoveryInput, blockNumber: bigint, blockHash: Hex, pass: PreparedReconciliationPass, finalized = false): Promise<void> {
  const reference = createPublicClient({transport:http(input.referenceRpcUrl,{retryCount:0,timeout:5000})});
  let localNonce: number | undefined, remoteNonce: number | undefined;
  await recoveryReads([
    async () => { if (await pass.read(() => reference.getChainId())!==input.chainId) throw new Error("recovery reference chain mismatch"); },
    async () => {
      const block = await pass.read(() => reference.getBlock({blockNumber}));
      if (block.hash!==blockHash) throw new RecoveryReadinessError("reference-disagreement","recovery reference canonical disagreement");
    },
    async () => { localNonce = await pass.read(() => client.getTransactionCount({address:input.address,blockNumber})); },
    async () => { remoteNonce = await pass.read(() => reference.getTransactionCount({address:input.address,blockNumber})); }
  ]);
  if (localNonce!==remoteNonce) throw new RecoveryReadinessError("reference-disagreement","recovery reference nonce disagreement");
  if (finalized) {
    const final = await pass.read(() => reference.getBlock({blockTag:"finalized"}));
    if (final.number===null || !final.hash || final.number<blockNumber) throw new Error("recovery reference finality pending");
    const localFinal = await pass.read(() => client.getBlock({blockNumber:final.number!}));
    const remoteAgain = await pass.read(() => reference.getBlock({blockNumber}));
    if (localFinal.hash!==final.hash || remoteAgain.hash!==blockHash) throw new Error("recovery reference finalized chain disagreement");
  }
}

export async function verifyRecoveryIdentity(client: PublicClient, input: MissionRecoveryInput, pass: PreparedReconciliationPass, blockNumber?: bigint) {
  if (await pass.read(() => client.getChainId()) !== input.chainId) throw new Error("recovery RPC chain mismatch");
  const block = await pass.read(() => client.getBlock(blockNumber === undefined ? { blockTag: "latest" } : { blockNumber }));
  if (block.number === null || !block.hash) throw new Error("recovery canonical block unavailable");
  assertBatchQuoteFresh({blockNumber:block.number,blockHash:block.hash,blockTimestamp:block.timestamp});
  await recoveryReads([
    async () => {
      const slot = await pass.read(() => client.getStorageAt({ address: input.game, slot: implementationSlot, blockNumber: block.number! }));
      if (slot?.slice(-40).toLowerCase() !== input.implementation.slice(2).toLowerCase()) throw new Error("recovery implementation changed");
    },
    ...input.identities.map(identity => async () => {
      const code = await pass.read(() => client.getCode({ address: identity.address, blockNumber: block.number! }));
      if (!code || keccak256(code) !== identity.codeHash) throw new Error("recovery deployed code changed");
    })
  ]);
  const items: BatchLeg[] = JSON.parse(input.membership);
  const id = BigInt(items[0]!.missionId);
  const abi = parseAbi(["function fleetMission(uint256) view returns (uint8,uint8,address,uint256,uint256,uint64,uint64,uint64,uint128,(uint128 metal,uint128 crystal,uint128 deuterium),uint256)"]);
  const mission = await pass.read(() => client.readContract({address:input.game,abi,functionName:"fleetMission",args:[id],blockNumber:block.number!}));
  if (mission[1]!==0 || mission[2].toLowerCase()!==input.mission.owner.toLowerCase() || mission[3].toString()!==input.mission.origin
    || mission[4].toString()!==input.mission.target || mission[7].toString()!==input.mission.returnAt
    || mission[9].metal!==0n || mission[9].crystal!==0n || mission[9].deuterium!==0n
    || ![2,3,4,5].includes(mission[0])) throw new Error("recovery planet transport prestate mismatch");
  const base = BigInt(keccak256(encodeAbiParameters([{type:"uint256"},{type:"uint256"}],[id,24n])));
  await recoveryReads(([[7n,input.mission.shipsWords[0]],[8n,input.mission.shipsWords[1]],[11n,input.mission.bodyFlags]] as const).map(([offset,expected]) => async () => {
    const value = await pass.read(() => client.getStorageAt({address:input.game,slot:toHex(base+offset,{size:32}),blockNumber:block.number!}));
    if (value!==expected) throw new Error("recovery mission ships/body flags changed");
  }));
  await verifyRecoveryReference(client,input,block.number,block.hash,pass);
  const canonical = await pass.read(() => client.getBlock({ blockNumber: block.number! }));
  if (canonical.hash !== block.hash) throw new Error("recovery identity block changed");
  return { ...block, recoveryComplete: mission[0]===3 || mission[0]===4 };
}

/** Recheck the exact proof after all candidate/nonce awaits. A moved head requires a fresh
 * whole proof; never combine old code/asset identity with newer fee/simulation provenance. */
export function recoveryProofGuard(client: PublicClient, input: MissionRecoveryInput,
  block: Awaited<ReturnType<typeof verifyRecoveryIdentity>>, pass: PreparedReconciliationPass,
  feeGuard: () => void, trace?: RecoveryTrace): PreparedReplayGuard {
  const assertFresh = () => {
    pass.assertActive(); feeGuard();
    assertBatchQuoteFresh({blockNumber:block.number!,blockHash:block.hash!,blockTimestamp:block.timestamp});
  };
  return Object.assign(assertFresh, { finalCheck: async () => {
    if(trace)trace.stage="final-identity";
    const identity = await verifyRecoveryIdentity(client,input,pass,block.number!);
    if (identity.hash!==block.hash) throw new Error("recovery proof block changed");
    if(trace)trace.stage="final-head";
    const latest = await pass.read(() => client.getBlock({blockTag:"latest"}));
    if (latest.number!==block.number || latest.hash!==block.hash) throw new RecoveryReadinessError("head-moved","recovery proof head moved; refresh complete proof");
    if(trace)trace.stage="final-guard";
    assertFresh();
  } });
}

export async function prepareRecoveryEnvelope(client: PublicClient, input: MissionRecoveryInput,
  policy: MissionBatchPolicy, pass: PreparedReconciliationPass, head?: {number: bigint | null; hash: Hex | null}, trace?: RecoveryTrace) {
  const binding = recoveryBinding(input);
  policy = {...policy,maxFeeWei: BigInt(input.maxFeeWei)<policy.maxFeeWei ? BigInt(input.maxFeeWei):policy.maxFeeWei};
  if(trace)trace.stage="proof";
  const block = await verifyRecoveryIdentity(client, input, pass, head?.number ?? undefined);
  if(head && block.hash!==head.hash)throw new RecoveryReadinessError("canonical-changed");
  if (block.baseFeePerGas === null) throw new Error("recovery base fee unavailable");
  const tip = await pass.read(() => client.estimateMaxPriorityFeePerGas());
  // Unknown original priority is bounded by the original max fee, not guessed equal to it.
  const bumped = (BigInt(input.originalFee.maxFeePerGas)*125n+99n)/100n;
  const maxPriorityFeePerGas = tip > bumped ? tip : bumped;
  const fresh = block.baseFeePerGas*2n+tip;
  const maxFeePerGas = fresh > maxPriorityFeePerGas ? fresh : maxPriorityFeePerGas;
  const transaction = { type: "eip1559" as const, chainId: binding.chainId, nonce: binding.nonce,
    to: binding.to, data: binding.data, value: 0n, gas: BigInt(input.gas), maxFeePerGas, maxPriorityFeePerGas };
  let evidence = "";
  const guard = await validateMissionBatchReplay(client, serializeTransaction(transaction), {
    items: JSON.parse(binding.membership), account: binding.address, game: binding.to, chainId: binding.chainId, policy, blockNumber: block.number!
  }, pass, input.allowAlreadySettled && block.recoveryComplete, (value) => { evidence=value; });
  const balance = await pass.read(() => client.getBalance({ address: binding.address, blockNumber: block.number! }));
  // Funding check is deliberately conservative: require the entire immutable transaction budget.
  if (balance < (policy.maxFeeWei < 200_000_000_000_000n ? policy.maxFeeWei : 200_000_000_000_000n)) throw new Error("recovery balance below capped budget");
  guard();
  return { transaction, guard: recoveryProofGuard(client,input,block,pass,guard,trace), evidence };
}

/** Complete pre-sign read path, with no coordinator, lease or signing capability. */
export async function recoveryReadiness(client: PublicClient, input: MissionRecoveryInput, policy: MissionBatchPolicy,
  trace = new RecoveryTrace(), persisted?: {raw: Hex; hash: Hex; maxFeeWei: string; attempts: number; nextRetry: number}) {
  const binding=recoveryBinding(input);
  const reconcile=async (pass: PreparedReconciliationPass)=>{
    for(const hash of [binding.originalHash,...(persisted?[persisted.hash]:[])])
      if(await recoveryCandidateReceipt(client,hash,pass))throw new RecoveryReadinessError("candidate-included");
    await assertRecoveryNonce(client,binding,pass);
  };
  trace.stage="initial-candidates";
  await readOnlyRecoveryPass(p=>reconcile(trace.wrap(p)));
  const complete=async (pass: PreparedReconciliationPass)=>{
    if(persisted) {
      // Explicit recovery performs an initial reconciliation, then the replay pass.
      await reconcile(pass);
      try {
        const tx=await pass.read(()=>client.getTransaction({hash:persisted.hash}));
        if(tx.hash.toLowerCase()!==persisted.hash.toLowerCase() || tx.blockHash!==null)throw new RecoveryReadinessError("candidate-included");
      } catch(error) {pass.assertActive();if(!(error instanceof TransactionNotFoundError))throw error;}
      // Conservative read-only result: never skip even an early-attempt production wait.
      trace.stage="retry-hold";
      if(persisted.nextRetry>Date.now())throw new RecoveryReadinessError("retry-cooldown");
    }
    trace.stage="pause";
    const paused=await pass.read(()=>client.getStorageAt({address:binding.to,slot:toHex(52n,{size:32})}));
    if(!policy.enabled || (paused!==undefined && BigInt(paused)!==0n))throw new RecoveryReadinessError("paused");
    const head=await acquireRecoveryHead(client,pass,trace);
    let guard: PreparedReplayGuard;
    if(persisted) {
      trace.stage="proof";
      const tx=parseTransaction(persisted.raw);
      if(keccak256(persisted.raw)!==persisted.hash || tx.nonce!==binding.nonce || !tx.r || !tx.s
        || (tx.accessList?.length??0)!==0 || (await recoverTransactionAddress({serializedTransaction:persisted.raw as TransactionSerialized})).toLowerCase()!==binding.address
        || !/^[0-9]{1,18}$/.test(persisted.maxFeeWei) || BigInt(persisted.maxFeeWei)<=0n || BigInt(persisted.maxFeeWei)>BigInt(input.maxFeeWei))throw new RecoveryReadinessError("journal-mismatch");
      const block=await verifyRecoveryIdentity(client,input,pass,head.number!);
      if(block.hash!==head.hash)throw new RecoveryReadinessError("canonical-changed");
      const cap=BigInt(persisted.maxFeeWei)<policy.maxFeeWei?BigInt(persisted.maxFeeWei):policy.maxFeeWei;
      const balance=await pass.read(()=>client.getBalance({address:binding.address,blockNumber:block.number!}));
      if(balance<cap)throw new RecoveryReadinessError("proof-rejected");
      const feeGuard=await validateMissionBatchReplay(client,persisted.raw,{items:JSON.parse(binding.membership),account:binding.address,
        game:binding.to,chainId:binding.chainId,policy:{...policy,maxFeeWei:cap},blockNumber:block.number!},pass,input.allowAlreadySettled&&block.recoveryComplete);
      guard=recoveryProofGuard(client,input,block,pass,feeGuard,trace);
    } else guard=(await prepareRecoveryEnvelope(client,input,policy,pass,head,trace)).guard;
    trace.stage="post-quote-candidates";
    if(persisted)await reconcile(pass);
    else await readOnlyRecoveryPass(p=>reconcile(trace.wrap(p)));
    await guard.finalCheck!();
    guard();
    return trace.diagnostic();
  };
  // Replay acquisition/proof/observer reads share ONE reconciliation budget.
  // Pre-sign preparation remains lease-only in production, not a reconciliation.
  return persisted ? readOnlyRecoveryPass(p=>{
    const pass=trace.wrap(p);
    // replayIntent charges the validation callback itself as well as its RPCs.
    return pass.read(()=>complete(pass));
  })
    : complete(trace.wrap({assertActive:()=>{},read:operation=>operation()}));
}
