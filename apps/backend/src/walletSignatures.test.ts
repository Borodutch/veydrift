import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  createDelegationAwareWalletMessageVerifier,
  createRpcWalletMessageVerifier,
  createWalletMessageVerifier,
  walletMessageSignatureMaxBytes,
  walletMessageVerificationGas,
  WalletMessageVerificationUnavailableError,
} from "./walletSignatures";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const otherAccount = privateKeyToAccount(`0x${"22".repeat(32)}`);

describe("wallet message verifier", () => {
  test("accepts the main wallet without resolving delegation", async () => {
    const message = "main";
    const signature = await account.signMessage({ message });
    let delegateLookups = 0;
    const verify = createDelegationAwareWalletMessageVerifier(
      async () => { throw new Error("smart-wallet verifier should not run"); },
      async () => {
        delegateLookups += 1;
        return otherAccount.address;
      },
    );

    expect(await verify({ address: account.address, message, signature })).toBe(true);
    expect(delegateLookups).toBe(0);
  });

  test("accepts the configured delegate for the same main-wallet message", async () => {
    const message = "act for main";
    const signature = await otherAccount.signMessage({ message });
    let smartWalletCalls = 0;
    const verify = createDelegationAwareWalletMessageVerifier(
      async () => {
        smartWalletCalls += 1;
        return false;
      },
      async (main) => {
        expect(main).toBe(account.address);
        return otherAccount.address;
      },
    );

    const input = { address: account.address, message, signature };
    expect(await verify(input)).toBe(true);
    expect(smartWalletCalls).toBe(0);
  });

  test("falls back to smart-wallet verification for a configured smart delegate", async () => {
    const verifiedAddresses: string[] = [];
    const verify = createDelegationAwareWalletMessageVerifier(
      async ({ address }) => {
        verifiedAddresses.push(address);
        return address === otherAccount.address;
      },
      async () => otherAccount.address,
    );

    expect(await verify({ address: account.address, message: "smart delegate", signature: "0x1234" })).toBe(true);
    expect(verifiedAddresses).toEqual([account.address, otherAccount.address]);
  });

  test("rejects when the main signature fails and no delegate is configured", async () => {
    const verify = createDelegationAwareWalletMessageVerifier(async () => false, async () => null);
    expect(await verify({ address: account.address, message: "no delegate", signature: "0x1234" })).toBe(false);
  });

  test("classifies delegation lookup failures as temporarily unavailable", async () => {
    const verify = createDelegationAwareWalletMessageVerifier(async () => false, async () => {
      throw new Error("RPC offline");
    });
    await expect(verify({ address: account.address, message: "lookup", signature: "0x1234" }))
      .rejects.toBeInstanceOf(WalletMessageVerificationUnavailableError);
  });

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
