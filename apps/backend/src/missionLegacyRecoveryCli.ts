import { RecoveryTrace, RecoveryReadinessError } from "./recoveryReadiness";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPublicClient, defineChain, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadBackendConfig } from "./config";
import { VeydriftGameReader } from "./evm";
import { ViemMissionResolutionChainClient } from "./missionResolution";
import { recoveryReadiness, recoveryBinding, type MissionRecoveryInput } from "./missionLegacyRecovery";
import { ResolverTransactionCoordinator } from "./resolverTransactions";

// #58 independently reviewed complete 15-runtime graph and economic provenance.
// Any byte change requires a reviewed source release, not an operator override.
export const reviewedRecoveryManifestSha256 = "bf984f3a4bafd23b5529d84e8b1c9d11178a4701a78cd3223ebc0792a1d4a45c";
export function verifyReviewedRecoveryManifest(content: string): MissionRecoveryInput {
  if (createHash("sha256").update(content).digest("hex")!==reviewedRecoveryManifestSha256)
    throw new Error("recovery manifest differs from independently reviewed digest");
  const input = JSON.parse(content) as MissionRecoveryInput;
  recoveryBinding(input);
  return input;
}

export async function runMissionRecovery(args: string[]): Promise<void> {
  if (args.length < 2 || args[0] !== "--input" || !args[1] || args.slice(2).some((a) => a !== "--broadcast")
    || args.length > 3) throw new Error("usage: --input reviewed-binding.json [--broadcast]");
  const content=readFileSync(args[1],"utf8");
  if (content.length>32768) throw new Error("recovery input too large");
  const input = verifyReviewedRecoveryManifest(content);
  const binding = recoveryBinding(input), broadcast = args.includes("--broadcast");
  const {config} = loadBackendConfig();
  if (!config.rpcUrl || config.chainId !== binding.chainId || config.gameContractAddress?.toLowerCase() !== binding.to
    || !config.resolverTransactionStorePath || config.resolverTransactionStorePath===":memory:" || !config.missionBatch?.enabled) throw new Error("configured recovery deployment mismatch");
  if (new URL(config.rpcUrl).host===new URL(input.referenceRpcUrl).host) throw new Error("independent recovery reference required");
  const chain = defineChain({id:config.chainId,name:"recovery",nativeCurrency:{name:"Ether",symbol:"ETH",decimals:18},rpcUrls:{default:{http:[config.rpcUrl]}}});
  const client = createPublicClient({chain,transport:http(config.rpcUrl,{retryCount:0,timeout:10_000})});
  const trace=new RecoveryTrace();
  try {
  if (!broadcast) {
    // No coordinator constructor, migrations, lease, signing or journal writes on dry run.
    const db = new Database(config.resolverTransactionStorePath, {readonly:true});
    let persisted: ReturnType<typeof assertRecoveryJournalReadiness>;
    try {
      persisted=assertRecoveryJournalReadiness(db,binding, (BigInt(input.maxFeeWei)<config.missionBatch.maxFeeWei?BigInt(input.maxFeeWei):config.missionBatch.maxFeeWei).toString());
    } finally { db.close(); }
    const diagnostic=await recoveryReadiness(client,input,config.missionBatch,trace,persisted);
    console.log(JSON.stringify({mode:"read-only-readiness",...diagnostic,
      note:"No lease, signature, reservation, send or journal mutation; not authorization to broadcast."}));
    return;
  }
  if (!config.missionResolverPrivateKey) throw new Error("configured mission resolver signer required");
  const account = privateKeyToAccount(config.missionResolverPrivateKey);
  if (account.address.toLowerCase() !== binding.address || (config.randomnessFulfillerPrivateKey
    && privateKeyToAccount(config.randomnessFulfillerPrivateKey).address.toLowerCase() !== binding.address))
    throw new Error("configured recovery signer mismatch");
  const coordinator = new ResolverTransactionCoordinator(config.resolverTransactionStorePath);
  const reader = new VeydriftGameReader(config,undefined,{hydrateQueueStartedAt:false});
  const missions = new ViemMissionResolutionChainClient(reader,binding.to,account,client,undefined,chain,undefined,coordinator,
    config.moonContractAddress,config.randomnessEngineAddress,config.missionBatch);
  await missions.recoverLegacyMission(input,trace);
  console.log(JSON.stringify({mode:"reconciled",chainId:binding.chainId,address:binding.address,nonce:binding.nonce,originalHash:binding.originalHash}));
  } catch(error) {
    console.error(JSON.stringify({mode:broadcast?"recovery":"read-only-readiness",...trace.diagnostic(error)}));
    throw error;
  }
}
if (import.meta.main) runMissionRecovery(process.argv.slice(2)).catch(() => {
  // Raw viem errors can contain signatures or credentials. Never print caught objects/text.
  console.error("Recovery did not complete. Preserve journal; inspect public candidate/lineage state and retry identical input with compatible code.");
  process.exitCode=1;
});

/** SELECT-only admission; never migrate, claim a lease, or expose envelope bytes. */
export function assertRecoveryJournalReadiness(db: Database, binding: ReturnType<typeof recoveryBinding>, maxFeeWei: string): {raw:Hex;hash:Hex;maxFeeWei:string;attempts:number;nextRetry:number}|undefined {
  const {chainId,address,nonce,originalHash}=binding;
  const reject=():never=>{throw new RecoveryReadinessError("journal-mismatch");};
  const row=db.query("SELECT operation_id,membership,nonce,status,serialized_transaction FROM resolver_prepared_intents WHERE chain_id=? AND resolver_address=? AND transaction_hash=?")
    .get(chainId,address,originalHash) as {operation_id:string;membership:string;nonce:number;status:string;serialized_transaction:string|null}|null;
  if(!row || row.operation_id!==binding.operationId || row.membership!==binding.membership || row.nonce!==nonce || row.status!=="pending" || row.serialized_transaction!==null)reject();
  const groups=db.query("SELECT nonce,binding,max_fee_wei,reservation_id,alternative_hash,winner_hash,finalized FROM resolver_nonce_recovery WHERE chain_id=? AND resolver_address=? ORDER BY nonce LIMIT 33")
    .all(chainId,address) as Array<{nonce:number;binding:string;max_fee_wei:string;reservation_id:string|null;alternative_hash:Hex|null;winner_hash:string|null;finalized:number}>;
  if(groups.length>32 || groups.some(g=>(g.nonce!==nonce&&!g.finalized) || (g.nonce===nonce&&(g.binding!==JSON.stringify(binding)||g.max_fee_wei!==maxFeeWei||g.winner_hash||g.finalized))))reject();
  const group=groups.find(g=>g.nonce===nonce);
  if(db.query("SELECT 1 FROM resolver_prepared_intents WHERE chain_id=? AND resolver_address=? AND status!='finalized' AND transaction_hash!=? AND transaction_hash!=? LIMIT 1").get(chainId,address,originalHash,group?.alternative_hash??originalHash)
    || db.query("SELECT 1 FROM resolver_signing_reservations WHERE chain_id=? AND resolver_address=? AND transferred=0 LIMIT 1").get(chainId,address)
    || db.query("SELECT 1 FROM resolver_send_fences WHERE chain_id=? AND resolver_address=? LIMIT 1").get(chainId,address))reject();
  if(!group?.alternative_hash) {if(group?.reservation_id)reject();return undefined;}
  const persisted=db.query("SELECT i.serialized_transaction AS raw,i.transaction_hash AS hash,i.replay_max_fee_wei AS maxFeeWei,i.send_attempts AS attempts,i.next_retry_ms AS nextRetry FROM resolver_prepared_intents i JOIN resolver_signing_reservations r ON r.id=? AND r.chain_id=i.chain_id AND r.resolver_address=i.resolver_address AND r.operation_id=i.operation_id AND r.nonce=i.nonce AND r.membership=i.membership AND r.transferred=1 JOIN resolver_signing_results s ON s.reservation_id=r.id AND s.transaction_hash=i.transaction_hash AND s.serialized_transaction=i.serialized_transaction WHERE i.chain_id=? AND i.resolver_address=? AND i.transaction_hash=? AND i.operation_id=? AND i.membership=? AND i.nonce=? AND i.status='pending' AND i.replay_state IN ('unvalidated','ready','retryable')")
    .get(group.reservation_id,chainId,address,group.alternative_hash,binding.operationId,binding.membership,nonce) as {raw:Hex;hash:Hex;maxFeeWei:string;attempts:number;nextRetry:number}|null;
  if(!persisted?.raw || persisted.maxFeeWei!==maxFeeWei || !Number.isSafeInteger(persisted.attempts) || persisted.attempts<0 || !Number.isSafeInteger(persisted.nextRetry) || persisted.nextRetry<0)reject();
  return persisted!;
}
