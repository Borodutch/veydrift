import type { PublicClient, Hex } from "viem";
import { BaseError, HttpRequestError, RpcRequestError, TimeoutError, WebSocketRequestError, ContractFunctionRevertedError, ExecutionRevertedError, TransactionNotFoundError, TransactionReceiptNotFoundError } from "viem";
import type { PreparedReconciliationPass, LegacyRecoveryBinding } from "./resolverTransactions";
import { assertBatchQuoteFresh, BatchQuoteExpiredError } from "./missionBatchFees";

export type RecoveryStage = "journal" | "retry-hold" | "initial-candidates" | "pause" | "fresh-head" | "proof" | "post-quote-candidates" | "final-identity" | "final-head" | "final-guard" | "dispatch";
export type RecoveryReason = "retry-cooldown" | "rpc-unavailable" | "candidate-included" | "nonce-changed" | "canonical-changed" | "paused" | "head-timeout" | "latency-margin" | "head-moved" | "pass-deadline" | "pass-budget" | "lease-lost" | "proof-rejected" | "journal-mismatch" | "reference-disagreement" | "quote-expired";
export class RecoveryReadinessError extends Error {
  constructor(readonly reason: RecoveryReason, message: string = reason) { super(message); }
}
export type RecoveryDiagnostic = { stage: RecoveryStage; reason: RecoveryReason | "ready"; elapsedMs: number; reads: number; blockNumber?: string; blockHash?: Hex };
/** Classify viem transport causes by type only, keeping domain/revert errors intact.
 * Called at read boundaries; never inspect or copy provider messages or request fields. */
export function classifyRecoveryReadError(error: unknown): unknown {
  if (!(error instanceof BaseError)) return error;
  let cause: unknown = error;
  for (let depth=0; cause instanceof BaseError && depth<16; depth++, cause=cause.cause) {
    if (cause instanceof ContractFunctionRevertedError || cause instanceof ExecutionRevertedError) return error;
    if (cause instanceof HttpRequestError || cause instanceof RpcRequestError
      || cause instanceof TimeoutError || cause instanceof WebSocketRequestError) return new RecoveryReadinessError("rpc-unavailable");
  }
  return error;
}

/** Only our finite codes cross the operator boundary; never serialize caught RPC errors. */
export class RecoveryTrace {
  private started = performance.now();
  stage: RecoveryStage = "journal";
  reads = 0;
  block?: { number: bigint; hash: Hex };
  wrap(pass: PreparedReconciliationPass): PreparedReconciliationPass {
    return { assertActive: pass.assertActive, read: async operation => { this.reads++; try { return await pass.read(operation); } catch(error) { pass.assertActive(); throw classifyRecoveryReadError(error); } } };
  }
  diagnostic(error?: unknown): RecoveryDiagnostic {
    return { stage: this.stage, reason: error === undefined ? "ready" : error instanceof RecoveryReadinessError ? error.reason : error instanceof BatchQuoteExpiredError ? "quote-expired" : "proof-rejected",
      elapsedMs: Math.round(performance.now()-this.started), reads: this.reads,
      ...(this.block ? {blockNumber:this.block.number.toString(),blockHash:this.block.hash} : {}) };
  }
}

/** A read-only pass has the same 128-read/5s limits as coordinator reconciliation.
 * Drain underlying reads before returning; this path cannot reserve/sign/send. */
export async function readOnlyRecoveryPass<T>(run: (pass: PreparedReconciliationPass) => Promise<T>): Promise<T> {
  const deadline=performance.now()+5000;
  let reads=0;
  const assertActive=()=>{if(performance.now()>=deadline)throw new RecoveryReadinessError("pass-deadline");};
  const pass: PreparedReconciliationPass={assertActive,read:async operation=>{
    assertActive(); if(reads>=128)throw new RecoveryReadinessError("pass-budget"); reads++;
    const value=await operation(); assertActive(); return value;
  }};
  return run(pass);
}

// Share the exact absent-candidate and nonce proof with production. A present receipt
// is NOT readiness: production must hydrate/reconcile it, never sign around it.
export async function recoveryCandidateReceipt(client: PublicClient, hash: Hex, pass: PreparedReconciliationPass) {
  try { return await pass.read(()=>client.getTransactionReceipt({hash})); }
  catch(error) {
    pass.assertActive();
    if(error instanceof RecoveryReadinessError)throw error;
    if(!(error instanceof TransactionReceiptNotFoundError))throw new RecoveryReadinessError("rpc-unavailable");
    try {
      const tx=await pass.read(()=>client.getTransaction({hash}));
      if(tx.blockHash!==null)throw new RecoveryReadinessError("candidate-included");
    } catch(error) {
      pass.assertActive();
      if(error instanceof RecoveryReadinessError)throw error;
      if(!(error instanceof TransactionNotFoundError))throw new RecoveryReadinessError("rpc-unavailable");
    }
    return null;
  }
}
export async function assertRecoveryNonce(client: PublicClient, binding: LegacyRecoveryBinding, pass: PreparedReconciliationPass) {
  const block=await pass.read(()=>client.getBlock({blockTag:"latest"}));
  if(block.number===null || !block.hash)throw new RecoveryReadinessError("canonical-changed");
  assertBatchQuoteFresh({blockNumber:block.number,blockHash:block.hash,blockTimestamp:block.timestamp});
  const latest=await pass.read(()=>client.getTransactionCount({address:binding.address,blockNumber:block.number!}));
  const canonical=await pass.read(()=>client.getBlock({blockNumber:block.number!}));
  if(canonical.hash!==block.hash)throw new RecoveryReadinessError("canonical-changed");
  const pending=await pass.read(()=>client.getTransactionCount({address:binding.address,blockTag:"pending"}));
  if(latest!==binding.nonce || pending!==binding.nonce)throw new RecoveryReadinessError("nonce-changed","recovery nonce changed; identify canonical hash or unexplained pending advance");
}

/** One acquisition, never retry a proof until lucky. Base has a 2s block interval.
 * Observe one transition in <= 2.5s / 32 reads. Admission reserves a conservative
 * 32 serial RPC waves plus 250ms margin using the slowest sampled RTT. The final
 * number+hash guard remains authoritative when later latency changes. */
export async function acquireRecoveryHead(client: PublicClient, pass: PreparedReconciliationPass, trace?: RecoveryTrace) {
  if(trace)trace.stage="fresh-head";
  const started=performance.now();
  let previous: Awaited<ReturnType<PublicClient["getBlock"]>> | undefined, maxRtt=0;
  for(let reads=0;reads<32;reads++) {
    pass.assertActive();
    const before=performance.now();
    if(before-started>=2500)throw new RecoveryReadinessError("head-timeout");
    const block=await pass.read(()=>client.getBlock({blockTag:"latest"}));
    const after=performance.now(); maxRtt=Math.max(maxRtt,after-before);
    if(after-started>=2500)throw new RecoveryReadinessError("head-timeout");
    if(block.number===null || !block.hash)throw new RecoveryReadinessError("canonical-changed");
    assertBatchQuoteFresh({blockNumber:block.number,blockHash:block.hash,blockTimestamp:block.timestamp});
    if(previous && block.number===previous.number!+1n && block.hash!==previous.hash) {
      const detection=after-before+100;
      if(detection+32*maxRtt+250>=2000)throw new RecoveryReadinessError("latency-margin");
      if(trace)trace.block={number:block.number,hash:block.hash};
      return block;
    }
    if(previous && (block.number!==previous.number || block.hash!==previous.hash))throw new RecoveryReadinessError("canonical-changed");
    previous=block;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new RecoveryReadinessError("head-timeout");
}
