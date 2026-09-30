import { afterEach, describe, expect, test } from "bun:test";
import { BASE_MAINNET, encodeBurningChickenMoonCall, fetchBurningChickenForOwner, sendBurningChickenMoonTransaction, type Eip1193Provider } from "./walletFlow";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const owner = "0x4065de123cf18e9c4ab7da18db21518285ea164e";
const ownerResult = "0x0000000000000000000000004065de123cf18e9c4ab7da18db21518285ea164e";
const config = {
  nftContractAddress: "0x84EEA2bE67b17698B0E09B57eEEdA47aa921BbF0",
  burnContractAddress: "0x84EEA2bE67b17698B0E09B57eEEdA47aa921BbF0",
  burnSelector: "0x6364233d",
  rpcUrl: "http://213.133.101.30:8545",
};
const unavailable = "Chicken ownership could not be checked. Please try again later.";
const missingData = "0x7e273289" + (999999n).toString(16).padStart(64, "0"); // ERC721NonexistentToken(uint256)

describe("Chicken browser RPC", () => {
  test.each([config.rpcUrl, "", "not a URL", "https://user:secret@rpc.test", "https://base.example.test/"])("reads the verified #90331 fixture via HTTPS with config %s", async rpcUrl => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(rpcUrl === "https://base.example.test/" ? rpcUrl : BASE_MAINNET.rpcUrls[0]);
      expect(JSON.parse(String(init?.body))).toMatchObject({ method: "eth_call", params: [{ to: config.nftContractAddress, data: "0x6352211e" + (90331n).toString(16).padStart(64, "0") }, "latest"] });
      return Response.json({ result: ownerResult });
    }) as unknown as typeof fetch;
    await expect(fetchBurningChickenForOwner(owner, "90331", { ...config, rpcUrl })).resolves.toEqual({ tokenId: "90331" });
    await expect(fetchBurningChickenForOwner("0x9999999999999999999999999999999999999999", "90331", { ...config, rpcUrl })).rejects.toThrow("not owned by the connected wallet");
  });

  test.each([false, true])("recognizes the deployed collection's exact nonexistent-token revert (nested=%s)", async nested => {
    const revert = { code: 3, message: "execution reverted", data: missingData };
    globalThis.fetch = (async () => Response.json({ error: nested ? { code: -32603, data: { originalError: revert } } : revert })) as unknown as typeof fetch;
    await expect(fetchBurningChickenForOwner(owner, "999999", config)).rejects.toThrow("Chicken #999999 was not found on Base mainnet.");
    await expect(fetchBurningChickenForOwner(owner, "90331", config)).rejects.toThrow(unavailable);
  });

  test.each([
    { error: { code: 3, message: "execution reverted" } },
    { error: { code: -32603, message: "Internal JSON-RPC error" } },
    { error: { code: -32005, message: "rate limit" } },
    { error: { code: 3, data: "0xdeadbeef", message: "execution reverted" } },
    { error: { code: 3, data: "0x7e273289", message: "execution reverted" } },
    {}, { result: null }, { result: 7 }, { result: "0x" }, { result: "garbage" },
    { result: "0x" + "0".repeat(64) },
    { result: "0x" + "f".repeat(24) + owner.slice(2) },
    { result: ownerResult + "00" },
  ])("does not claim absence for ambiguous RPC/revert/ABI response %j", async body => {
    globalThis.fetch = (async () => Response.json(body)) as unknown as typeof fetch;
    await expect(fetchBurningChickenForOwner(owner, "90331", config)).rejects.toThrow(unavailable);
  });

  test.each(["network", "timeout", "429", "malformed JSON"])("does not claim absence on %s failure", async failure => {
    globalThis.fetch = (async () => {
      if (failure === "network") throw new TypeError("Failed to fetch");
      if (failure === "timeout") throw new DOMException("Timed out", "TimeoutError");
      if (failure === "429") return new Response("Rate limited", { status: 429 });
      return new Response("not JSON");
    }) as unknown as typeof fetch;
    await expect(fetchBurningChickenForOwner(owner, "90331", config)).rejects.toThrow(unavailable);
  });

  test("a stalled ownership request times out without reporting a missing NFT", async () => {
    let transportSignal: AbortSignal | null | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      transportSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => transportSignal?.addEventListener("abort", () => reject(transportSignal?.reason), { once: true }));
    }) as unknown as typeof fetch;
    await expect(fetchBurningChickenForOwner(owner, "90331", config)).rejects.toThrow(unavailable);
    expect(transportSignal?.aborted).toBe(true);
  }, 15_000);

  test("preserves subscriber cancellation and aborts the transport", async () => {
    const controller = new AbortController();
    let transportSignal: AbortSignal | null | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      transportSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => transportSignal?.addEventListener("abort", () => reject(transportSignal?.reason), { once: true }));
    }) as unknown as typeof fetch;
    const pending = fetchBurningChickenForOwner(owner, "90331", config, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBe(controller.signal.reason);
    expect(transportSignal?.aborted).toBe(true);
  });

  test.each(["success", "revert", "wrong chain", "network"])("burn preflight uses the same safe HTTPS route, preserves exact encoding and fails closed: %s", async outcome => {
    const calls: string[] = [];
    const coordinates = { galaxy: 2, system: 419, position: 6 };
    const data = encodeBurningChickenMoonCall(config.burnSelector, "90331", "7", coordinates);
    let sends = 0;
    const provider = { async request({ method, params }: { method: string; params?: unknown[] }) {
      if (method === "wallet_switchEthereumChain") return null;
      if (method === "eth_chainId") return BASE_MAINNET.chainIdHex;
      if (method === "eth_sendTransaction") {
        sends++;
        expect(params).toEqual([{ from: owner, to: config.burnContractAddress, data, chainId: BASE_MAINNET.chainIdHex }]);
        return "0xmock-only";
      }
      throw new Error("Unexpected wallet method: " + method);
    } } as Eip1193Provider;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(BASE_MAINNET.rpcUrls[0]);
      const body = JSON.parse(String(init?.body));
      calls.push(body.method);
      if (outcome === "network") throw new TypeError("Failed to fetch");
      if (body.method === "eth_chainId") return Response.json({ result: outcome === "wrong chain" ? "0x1" : BASE_MAINNET.chainIdHex });
      expect(body.method).toBe("eth_call");
      expect(body.params).toEqual([{ from: owner, to: config.burnContractAddress, data }, "pending"]);
      return Response.json(outcome === "revert" ? { error: { code: 3, message: "execution reverted" } } : { result: "0x" });
    }) as unknown as typeof fetch;
    const pending = sendBurningChickenMoonTransaction(provider, owner, config, "90331", "7", coordinates);
    if (outcome === "success") await expect(pending).resolves.toBe("0xmock-only");
    else await expect(pending).rejects.toBeInstanceOf(Error);
    expect(sends).toBe(outcome === "success" ? 1 : 0);
    expect(calls).toEqual(outcome === "network" || outcome === "wrong chain" ? ["eth_chainId"] : ["eth_chainId", "eth_call"]);
  });
});
