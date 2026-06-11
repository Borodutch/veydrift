import { afterEach, describe, expect, test } from "bun:test";

import {
  buildDiagnosticsHandlers,
  installCrashDiagnostics,
  memorySnapshot,
  resetCrashDiagnosticsForTest
} from "./crashDiagnostics";

type LoggedEvent = { event: string; detail: Record<string, unknown> };

afterEach(() => {
  resetCrashDiagnosticsForTest();
});

describe("crash diagnostics memory snapshot", () => {
  test("reports rss/heap/external in mebibytes", () => {
    const snapshot = memorySnapshot({
      rss: 100 * 1024 * 1024,
      heapTotal: 50 * 1024 * 1024,
      heapUsed: 25 * 1024 * 1024,
      external: 2 * 1024 * 1024,
      arrayBuffers: 0
    });

    expect(snapshot).toEqual({
      rssMb: 100,
      heapTotalMb: 50,
      heapUsedMb: 25,
      externalMb: 2
    });
  });
});

describe("crash diagnostics handlers", () => {
  function record(): { logged: LoggedEvent[]; exits: number[] } {
    return { logged: [], exits: [] };
  }

  test("logs an unhandled rejection with a memory snapshot and does not exit", () => {
    const { logged, exits } = record();
    const handlers = buildDiagnosticsHandlers(
      (event, detail) => logged.push({ event, detail }),
      (code) => exits.push(code)
    );

    handlers.onUnhandledRejection(new Error("RPC request timed out after 10000ms"));

    expect(exits).toEqual([]);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.event).toBe("unhandledRejection");
    expect(logged[0]?.detail.reason).toBe("RPC request timed out after 10000ms");
    expect(logged[0]?.detail.memory).toMatchObject({ rssMb: expect.any(Number) });
    expect(typeof logged[0]?.detail.stack).toBe("string");
  });

  test("logs and exits non-zero on an uncaught exception", () => {
    const { logged, exits } = record();
    const handlers = buildDiagnosticsHandlers(
      (event, detail) => logged.push({ event, detail }),
      (code) => exits.push(code)
    );

    handlers.onUncaughtException(new Error("boom"));

    expect(logged[0]?.event).toBe("uncaughtException");
    expect(logged[0]?.detail.error).toBe("boom");
    expect(exits).toEqual([1]);
  });

  test("logs a non-Error rejection reason without a stack", () => {
    const { logged } = record();
    const handlers = buildDiagnosticsHandlers(
      (event, detail) => logged.push({ event, detail }),
      () => undefined
    );

    handlers.onUnhandledRejection("plain string reason");

    expect(logged[0]?.detail.reason).toBe("plain string reason");
    expect(logged[0]?.detail.stack).toBeUndefined();
  });

  test("records signals and exits zero", () => {
    const { logged, exits } = record();
    const handlers = buildDiagnosticsHandlers(
      (event, detail) => logged.push({ event, detail }),
      (code) => exits.push(code)
    );

    handlers.onSignal("SIGTERM");

    expect(logged[0]?.event).toBe("signal");
    expect(logged[0]?.detail.signal).toBe("SIGTERM");
    expect(exits).toEqual([0]);
  });
});

describe("installCrashDiagnostics", () => {
  test("registers handlers once and is idempotent", () => {
    const registrations: string[] = [];
    const target = {
      on(event: string) {
        registrations.push(event);
        return target;
      }
    } as unknown as NodeJS.EventEmitter;

    const first = installCrashDiagnostics({ target, logger: () => undefined, exit: () => undefined });
    const second = installCrashDiagnostics({ target, logger: () => undefined, exit: () => undefined });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(registrations).toEqual([
      "unhandledRejection",
      "uncaughtException",
      "SIGTERM",
      "SIGINT"
    ]);
  });
});
