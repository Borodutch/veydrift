import type { Address, AttackProtectionStatus, ChainReader, RpcMetrics, RpcTransactionReceipt } from "./evm";

/** Only the explicitly live API reads; indexed gameplay never goes through this wrapper. */
export type ApiChainReader = Pick<ChainReader, "getAttackProtectionStatus" | "getTransactionReceipt" | "rpcMetrics">;
type CacheEntry = { expiresAt: number; value: Promise<AttackProtectionStatus> };

export class CachedChainReader implements ApiChainReader {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly inner: ApiChainReader, private readonly ttlMs = 2_000) {}

  getTransactionReceipt(hash: string): Promise<RpcTransactionReceipt | null> {
    return this.inner.getTransactionReceipt?.(hash) ?? Promise.resolve(null);
  }

  getAttackProtectionStatus(wallet: Address, targetPlanetId: bigint, targetIsMoon = false): Promise<AttackProtectionStatus> {
    const key = `${wallet.toLowerCase()}:${targetPlanetId}:${targetIsMoon}`;
    const now = Date.now();
    const current = this.cache.get(key);
    if (current && current.expiresAt > now) return current.value;

    for (const [candidate, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(candidate);
    }
    // Bound retained targets as well as their lifetime, including long-running requests.
    if (this.cache.size >= 512) this.cache.delete(this.cache.keys().next().value!);
    const value = Promise.resolve().then(() => this.inner.getAttackProtectionStatus(wallet, targetPlanetId, targetIsMoon))
      .catch(error => {
        if (this.cache.get(key)?.value === value) this.cache.delete(key);
        throw error;
      });
    this.cache.set(key, { expiresAt: now + this.ttlMs, value });
    return value;
  }

  rpcMetrics(): RpcMetrics {
    return this.inner.rpcMetrics?.() ?? {
      activeRpcUrl: null,
      batchRequests: 0,
      callsByMethod: {},
      callsBySource: {},
      failoverCount: 0,
      httpRequests: 0,
      lastFailoverReason: null,
      rpcUrls: [],
      timeouts: 0,
      requestSource: "unavailable",
      startedHttpRequests: 0,
      finishedHttpRequests: 0,
      unfinishedHttpRequests: 0,
      oldestUnfinishedRequestAgeMs: null
    };
  }
}
