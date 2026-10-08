import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPublicClient, defineChain, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadBackendConfig } from "./config";
import { VeydriftGameReader } from "./evm";
import { ViemMissionResolutionChainClient } from "./missionResolution";
import { prepareRecoveryEnvelope, recoveryBinding, type MissionRecoveryInput } from "./missionLegacyRecovery";
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
  if (!broadcast) {
    // No coordinator constructor, migrations, lease, signing or journal writes on dry run.
    const db = new Database(config.resolverTransactionStorePath, {readonly:true});
    try {
      const row = db.query("SELECT operation_id,membership,nonce FROM resolver_prepared_intents WHERE chain_id=? AND resolver_address=? AND transaction_hash=?")
        .get(binding.chainId,binding.address,binding.originalHash) as {operation_id:string;membership:string;nonce:number}|null;
      if (!row || row.operation_id !== binding.operationId || row.membership !== binding.membership || row.nonce !== binding.nonce)
        throw new Error("dry-run journal binding mismatch");
    } finally { db.close(); }
    const pass = {read:<T>(op:()=>Promise<T>)=>op(),assertActive:()=>{}};
    const prepared=await prepareRecoveryEnvelope(client,input,config.missionBatch,pass);
    await prepared.guard.finalCheck?.();
    prepared.guard();
    console.log(JSON.stringify({mode:"read-only-preflight",chainId:binding.chainId,address:binding.address,nonce:binding.nonce,originalHash:binding.originalHash,
      note:"No lease/signature/journal mutation; execution rechecks ownership, receipts and nonce."}));
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
  await missions.recoverLegacyMission(input);
  console.log(JSON.stringify({mode:"reconciled",chainId:binding.chainId,address:binding.address,nonce:binding.nonce,originalHash:binding.originalHash}));
}
if (import.meta.main) runMissionRecovery(process.argv.slice(2)).catch(() => {
  // Raw viem errors can contain signatures or credentials. Never print caught objects/text.
  console.error("Recovery did not complete. Preserve journal; inspect public candidate/lineage state and retry identical input with compatible code.");
  process.exitCode=1;
});
