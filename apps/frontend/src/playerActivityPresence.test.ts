import { describe, expect, test } from "bun:test";

import { BackendDataStore } from "./backendDataStore";
import { playerActivityAwaySince } from "./playerActivityPresence";

const wallet = "0x2222222222222222222222222222222222222222";

describe("player activity presence", () => {
  test("consumes one dialog claim per wallet while retaining silent heartbeats", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({
        wallet,
        lastSeenAt: "1770000120",
        previousLastSeenAt: "1770000000",
      });
    }) as unknown as typeof fetch;

    try {
      const store = new BackendDataStore("https://api.example.test");
      await expect(store.claimPlayerActivityAwayWindow(wallet)).resolves.toMatchObject({
        previousLastSeenAt: "1770000000",
      });
      await expect(store.claimPlayerActivityAwayWindow(wallet)).resolves.toBeNull();
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not turn reconnect-sized heartbeat gaps into an away dialog", () => {
    expect(playerActivityAwaySince({
      lastSeenAt: "1770000060",
      previousLastSeenAt: "1770000000",
    })).toBeUndefined();
    expect(playerActivityAwaySince({
      lastSeenAt: "1770000090",
      previousLastSeenAt: "1770000000",
    })).toBe(1_770_000_000);
  });

  test("keeps presence heartbeats silent while a tab is hidden", async () => {
    const originalFetch = globalThis.fetch;
    const runtime = globalThis as unknown as {
      document?: {
        addEventListener: (name: string, listener: () => void) => void;
        removeEventListener: (name: string, listener: () => void) => void;
        visibilityState: "hidden" | "visible";
      };
      window?: {
        addEventListener: (name: string, listener: () => void) => void;
        removeEventListener: (name: string, listener: () => void) => void;
      };
    };
    const originalDocument = runtime.document;
    const originalWindow = runtime.window;
    const listeners = new Map<string, () => void>();
    const document = {
      addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
      visibilityState: "hidden" as "hidden" | "visible",
    };
    let calls = 0;
    runtime.document = document;
    runtime.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({ wallet, lastSeenAt: "1770000120", previousLastSeenAt: "1770000000" });
    }) as unknown as typeof fetch;

    try {
      const release = new BackendDataStore("https://api.example.test").startPlayerActivityPresence(wallet);
      await Promise.resolve();
      expect(calls).toBe(0);

      document.visibilityState = "visible";
      listeners.get("visibilitychange")?.();
      await Promise.resolve();
      await Promise.resolve();
      expect(calls).toBe(1);
      release();
    } finally {
      globalThis.fetch = originalFetch;
      runtime.document = originalDocument;
      runtime.window = originalWindow;
    }
  });
});
