import { expect, test } from "bun:test";
import { HttpJsonRpcTransport, RpcRetryAfterError, VeydriftGameReader } from "./evm";
import type { BackendConfig } from "./config";

const config = { rpcUrl: "https://fixture.invalid", rpcFallbackUrls: ["https://fallback.invalid"],
  gameContractAddress: "0x" + "22".repeat(20), chainId: 8453, indexFromBlock: 0n } as BackendConfig;
type Request = { id: number; method: string; params: any[] };
const words = (v: (number | bigint | string)[]) => "0x" + v.map(x => BigInt(x).toString(16).padStart(64, "0")).join("");
const result = (q: Request) => {
  const id = BigInt("0x" + q.params[0].data.slice(10));
  return q.params[0].data.startsWith("0xce02abe2") ? words([0, 999, 1])
    : words([1, 0, "0x" + "11".repeat(20), 1, 2, 1, id + 10n, 3, 0, 0, 0, 0, 0]);
};
const success = (p: Request[]) => p.map(q => ({ jsonrpc: "2.0", id: q.id, result: result(q) }));
const rpcError = (id: number, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
async function fixture(reply: (p: Request | Request[], url: string) => Response,
  run: (r: VeydriftGameReader, t: HttpJsonRpcTransport, urls: string[]) => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    urls.push(String(url));
    return reply(JSON.parse(init.body), String(url));
  }) as any;
  try {
    const t = new HttpJsonRpcTransport([config.rpcUrl!, ...config.rpcFallbackUrls!], { minRequestIntervalMs: 0, cacheTtlMs: 1000 });
    await run(new VeydriftGameReader(config, t), t, urls);
  } finally { globalThis.fetch = previousFetch; }
}

for (const header of [null, "garbage", "0", "-10", "Thu, 01 Jan 1970 00:00:00 GMT", "120"]) {
  test("canonical batch HTTP429 always cools down globally: " + header, async () => {
    const previousNow = Date.now;
    let now = 1_800_000_000_000;
    Date.now = () => now;
    try {
      let limited = true;
      await fixture(p => limited ? new Response("quota", { status: 429, headers: header === null ? {} : { "Retry-After": header } })
        : Response.json(success(p as Request[])), async (r, t, urls) => {
        const error = await r.getCanonicalFleetMissionBatch([3n, 9n], 42n, () => {}).catch(e => e);
        expect(error).toBeInstanceOf(RpcRetryAfterError);
        expect(error.retryAtMs).toBe(now + (header === "120" ? 120_000 : 60_000));
        expect(urls).toEqual([config.rpcUrl!]);
        expect(t.snapshot().failoverCount).toBe(0);
        t.failoverRpc("test explicit switch");
        now = error.retryAtMs - 1;
        await expect(t.request("eth_blockNumber", [])).rejects.toBeInstanceOf(RpcRetryAfterError);
        await expect(r.getCanonicalFleetMissionBatch([3n], 42n, () => {})).rejects.toBeInstanceOf(RpcRetryAfterError);
        expect(urls).toHaveLength(1);
        now++; limited = false;
        expect(await r.getCanonicalFleetMissionBatch([3n], 42n, () => {})).toHaveLength(1);
        expect(urls).toEqual([config.rpcUrl!, config.rpcFallbackUrls![0]!]);
        expect(t.snapshot().unfinishedHttpRequests).toBe(0);
      });
    } finally { Date.now = previousNow; }
  });
}

for (const [code, message] of [[-32014, "maximum 1 calls in 1 batch"], [-32602, "invalid params"], [4444, "pruned history unavailable"]] as const) {
  for (const quotaFirst of [false, true]) {
    test("whole canonical batch prioritizes quota over " + code + " in order " + quotaFirst, async () => {
      const bodies = [rpcError(1, code, message), rpcError(2, -32005, "rate limit")];
      if (quotaFirst) bodies.reverse();
      await fixture(() => Response.json(bodies), async (r, t, urls) => {
        await expect(r.getCanonicalFleetMissionBatch([3n], 42n, () => {})).rejects.toBeInstanceOf(RpcRetryAfterError);
        await expect(t.request("eth_blockNumber", [])).rejects.toBeInstanceOf(RpcRetryAfterError);
        expect(urls).toEqual([config.rpcUrl!]);
        expect(t.snapshot()).toMatchObject({ failoverCount: 0, unfinishedHttpRequests: 0 });
      });
    });
  }
}

test("quota takes precedence over genuine eth_getLogs pruned failover and single RPC retries", async () => {
  for (const batch of [true, false]) {
    await fixture(() => Response.json(batch
      ? [rpcError(1, 4444, "pruned history unavailable"), rpcError(2, 429, "quota")]
      : rpcError(1, -32005, "quota exhausted")), async (_r, t, urls) => {
      await expect(batch ? t.requestBatch([{ method: "eth_getLogs", params: [] }, { method: "eth_call", params: [] }])
        : t.request("eth_call", [])).rejects.toBeInstanceOf(RpcRetryAfterError);
      expect(urls).toEqual([config.rpcUrl!]);
      expect(t.snapshot().failoverCount).toBe(0);
    });
  }
});

test("nonquota 503 without usable Retry-After retains bounded retry and failover", async () => {
  await fixture((p, url) => url === config.rpcUrl! ? new Response("busy", { status: 503, headers: { "Retry-After": "invalid" } })
    : Response.json(success(p as Request[])), async (r, t, urls) => {
    expect(await r.getCanonicalFleetMissionBatch([3n], 42n, () => {})).toHaveLength(1);
    expect(urls).toEqual([config.rpcUrl!, config.rpcUrl!, config.rpcUrl!, config.rpcFallbackUrls![0]!]);
    expect(t.snapshot().failoverCount).toBe(1);
  });
});

test("nonquota 503 future Retry-After still establishes cooldown", async () => {
  await fixture(() => new Response("busy", { status: 503, headers: { "Retry-After": new Date(Date.now() + 120_000).toUTCString() } }), async (r, t, urls) => {
    await expect(r.getCanonicalFleetMissionBatch([3n], 42n, () => {})).rejects.toBeInstanceOf(RpcRetryAfterError);
    expect(urls).toHaveLength(1);
    expect(t.snapshot().failoverCount).toBe(0);
  });
});

const malformed: Record<string, (b: any[]) => unknown> = {
  "conflicting duplicate": b => [...b, { ...b[0], result: words([1, 0, "0x" + "11".repeat(20), 1, 2, 1, 999, 3, 0, 0, 0, 0, 0]) }],
  "identical duplicate": b => [...b, b[0]],
  "unexpected id": b => [...b, { ...b[0], id: 3 }],
  "string id": b => [{ ...b[0], id: "1" }, b[1]],
  "null id": b => [{ ...b[0], id: null }, b[1]],
  "fractional id": b => [{ ...b[0], id: 1.5 }, b[1]],
  "missing id": b => [{ jsonrpc: "2.0", result: b[0].result }, b[1]],
  "missing item": b => b.slice(1),
  "empty array": () => [],
  "null entry": b => [null, b[1]],
  "primitive entry": b => [false, b[1]],
  "nested array": b => [[b[0]], b[1]],
  "null body": () => null,
  "primitive body": () => 1,
  "nonarray success": b => b[0],
  "missing version": b => [{ id: 1, result: b[0].result }, b[1]],
  "wrong version": b => [{ ...b[0], jsonrpc: "1.0" }, b[1]],
  "result and error": b => [{ ...b[0], error: { code: -32014, message: "maximum 1 calls in 1 batch" } }, b[1]],
  "neither result nor error": b => [{ jsonrpc: "2.0", id: 1 }, b[1]],
  "null error": b => [{ jsonrpc: "2.0", id: 1, error: null }, b[1]],
  "malformed error": b => [{ jsonrpc: "2.0", id: 1, error: { code: "-32014", message: "maximum 1 calls in 1 batch" } }, b[1]],
  "batch limit before duplicate": b => [rpcError(1, -32014, "maximum 1 calls in 1 batch"), b[1], b[0]],
};
for (const [name, mutate] of Object.entries(malformed)) {
  test("canonical batch rejects " + name + " without fallback or poisoned cache", async () => {
    let bad = true;
    await fixture(p => Response.json(bad ? mutate(success(p as Request[])) : success(p as Request[]).reverse()), async (r, t, urls) => {
      await expect(r.getCanonicalFleetMissionBatch([3n], 42n, () => {})).rejects.toThrow("RPC batch response");
      expect(urls).toEqual([config.rpcUrl!]);
      expect(t.snapshot().failoverCount).toBe(0);
      bad = false;
      const snapshots = await r.getCanonicalFleetMissionBatch([3n], 42n, () => {});
      expect(snapshots[0]?.mission?.arrivalAt).toBe("13");
      expect(snapshots[0]?.orderingReady).toBe(true);
      expect(urls).toHaveLength(2);
    });
  });
}

test("shuffled canonical mission and ordering responses preserve every pairing", async () => {
  await fixture(p => Response.json(success(p as Request[]).reverse()), async (r, _t, urls) => {
    const snapshots = await r.getCanonicalFleetMissionBatch([3n, 9n], 42n, () => {});
    expect(snapshots.map(s => [s.mission?.missionId, s.mission?.arrivalAt, s.orderingReady]))
      .toEqual([["3", "13", true], ["9", "19", true]]);
    expect(urls).toHaveLength(1);
  });
});
