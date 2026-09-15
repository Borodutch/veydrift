import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  createRpcWalletMessageVerifier,
  createWalletMessageVerifier,
  walletMessageSignatureMaxBytes,
  walletMessageVerificationGas,
  WalletMessageVerificationUnavailableError,
} from "./walletSignatures";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const otherAccount = privateKeyToAccount(`0x${"22".repeat(32)}`);

describe("wallet message verifier", () => {
  test("keeps existing EOA verification local", async () => {
    const message = "Veydrift wallet verification";
    const signature = await account.signMessage({ message });
    let smartWalletCalls = 0;
    const verify = createWalletMessageVerifier(async () => {
      smartWalletCalls += 1;
      return false;
    });

    expect(await verify({ address: account.address, message, signature })).toBe(true);
    expect(smartWalletCalls).toBe(0);
  });

  test("falls back to smart-wallet verification when EOA recovery does not match", async () => {
    const message = "Veydrift Base Account verification";
    const signature = await account.signMessage({ message });
    let smartWalletCalls = 0;
    const verify = createWalletMessageVerifier(async (input) => {
      smartWalletCalls += 1;
      expect(input.address).toBe(otherAccount.address);
      return true;
    });

    expect(await verify({ address: otherAccount.address, message, signature })).toBe(true);
    expect(smartWalletCalls).toBe(1);
  });

  test("rejects oversized signatures without consuming smart-wallet RPC", async () => {
    let smartWalletCalls = 0;
    const verify = createWalletMessageVerifier(async () => {
      smartWalletCalls += 1;
      return true;
    });
    const signature = `0x${"11".repeat(walletMessageSignatureMaxBytes + 1)}` as `0x${string}`;

    expect(await verify({ address: account.address, message: "oversized", signature })).toBe(false);
    expect(smartWalletCalls).toBe(0);
  });

  test("bounds concurrent smart-wallet verification", async () => {
    let release: ((value: boolean) => void) | undefined;
    const verify = createWalletMessageVerifier(
      () => new Promise<boolean>((resolve) => { release = resolve; }),
      { maximumConcurrent: 1 },
    );
    const message = "bounded verification";
    const signature = await account.signMessage({ message });
    const input = { address: otherAccount.address, message, signature };
    const first = verify(input);
    await Promise.resolve();

    await expect(verify(input)).rejects.toBeInstanceOf(WalletMessageVerificationUnavailableError);
    release?.(false);
    expect(await first).toBe(false);
  });

  test("classifies smart-wallet RPC failures as temporarily unavailable", async () => {
    const verify = createWalletMessageVerifier(async () => {
      throw new Error("RPC offline");
    });
    const message = "unavailable verification";
    const signature = await account.signMessage({ message });

    await expect(verify({ address: otherAccount.address, message, signature }))
      .rejects.toBeInstanceOf(WalletMessageVerificationUnavailableError);
  });

  test("rate-limits only the RPC-backed smart-wallet fallback", async () => {
    let smartWalletCalls = 0;
    const verify = createWalletMessageVerifier(async () => {
      smartWalletCalls += 1;
      return false;
    }, {
      maximumPerWallet: 2,
      maximumTotal: 10,
    });
    const message = "rate-limited smart verification";
    const signature = await account.signMessage({ message });
    const input = { address: otherAccount.address, message, signature };

    expect(await verify(input)).toBe(false);
    expect(await verify(input)).toBe(false);
    await expect(verify(input)).rejects.toBeInstanceOf(WalletMessageVerificationUnavailableError);
    expect(smartWalletCalls).toBe(2);
    expect(await verify({ address: account.address, message, signature })).toBe(true);
  });

  test("uses the RPC smart-wallet verifier with an explicit gas cap", async () => {
    let rpcPayload: { method?: string; params?: Array<Record<string, string>> } | undefined;
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        rpcPayload = await request.json() as typeof rpcPayload;
        return Response.json({
          id: 1,
          jsonrpc: "2.0",
          result: `0x${"0".repeat(63)}1`,
        });
      },
    });
    try {
      const verify = createRpcWalletMessageVerifier([`http://127.0.0.1:${server.port}`]);
      expect(await verify({
        address: otherAccount.address,
        message: "counterfactual Base Account",
        signature: "0x1234",
      })).toBe(true);
      expect(rpcPayload?.method).toBe("eth_call");
      expect(rpcPayload?.params?.[0]?.gas).toBe(`0x${walletMessageVerificationGas.toString(16)}`);
    } finally {
      server.stop(true);
    }
  });
});
