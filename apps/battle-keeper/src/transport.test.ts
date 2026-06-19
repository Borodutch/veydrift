import { describe, expect, test } from "bun:test";

import { HttpJsonRpcTransport } from "./transport";

describe("HttpJsonRpcTransport", () => {
  test("fails over to the configured fallback after a retryable primary HTTP failure", async () => {
    const previousFetch = globalThis.fetch;
    const urls: string[] = [];

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      urls.push(url);
      if (url === "https://primary.example/rpc") {
        return new Response("unavailable", { status: 503 });
      }
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x1234" });
    }) as unknown as typeof fetch;

    try {
      const transport = new HttpJsonRpcTransport(
        ["https://primary.example/rpc", "https://fallback.example/rpc"],
        { maxAttempts: 1 }
      );

      await expect(transport.request<string>("eth_blockNumber", [])).resolves.toBe("0x1234");
      expect(urls).toEqual(["https://primary.example/rpc", "https://fallback.example/rpc"]);
      expect(transport.snapshot()).toEqual({
        activeRpcUrl: "https://fallback.example/rpc",
        failoverCount: 1,
        lastFailoverReason: "http_503",
        rpcUrls: ["https://primary.example/rpc", "https://fallback.example/rpc"]
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("fails over after a primary RPC returns HTTP 403", async () => {
    const previousFetch = globalThis.fetch;
    const urls: string[] = [];

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      urls.push(url);
      if (url === "https://publicnode.example/rpc") {
        return new Response("forbidden", { status: 403 });
      }
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x2911541" });
    }) as unknown as typeof fetch;

    try {
      const transport = new HttpJsonRpcTransport(
        ["https://publicnode.example/rpc", "http://self-hosted.example:8545"],
        { maxAttempts: 1 }
      );

      await expect(transport.request<string>("eth_blockNumber", [])).resolves.toBe("0x2911541");
      expect(urls).toEqual(["https://publicnode.example/rpc", "http://self-hosted.example:8545"]);
      expect(transport.snapshot()).toMatchObject({
        activeRpcUrl: "http://self-hosted.example:8545",
        failoverCount: 1,
        lastFailoverReason: "http_403"
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
