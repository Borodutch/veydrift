import { describe, expect, test } from "bun:test";

import { reportMigrationSnapshotFailure } from "./migrationSnapshot";
import {
  emitSanitizedProcessOutput,
  MissionReportGeneratorService
} from "./missionReportGenerator";
import { reportResolverNonceRecoveryFailure } from "./resolverNonceRecovery";
import type { SettlementIndexer } from "./indexer";

const privateKey = `0x${"ab".repeat(32)}`;
const bearer = "synthetic-bearer-canary-1234567890";
const queryKey = "synthetic-query-canary-1234567890";
const opaque = "synthetic-opaque-canary-1234567890";
const canaries = [privateKey, bearer, queryKey, opaque];

function expectNoCanaries(value: unknown): void {
  const output = JSON.stringify(value);
  for (const canary of canaries) expect(output).not.toContain(canary);
}

function captureConsole<T>(action: () => T | Promise<T>): Promise<{ result: T; lines: unknown[][] }> {
  const lines: unknown[][] = [];
  const originalError = console.error;
  const originalInfo = console.info;
  console.error = (...args: unknown[]) => { lines.push(args); };
  console.info = (...args: unknown[]) => { lines.push(args); };
  return Promise.resolve(action()).then(
    (result) => ({ result, lines }),
    (error) => { throw error; }
  ).finally(() => {
    console.error = originalError;
    console.info = originalInfo;
  });
}

describe("operator diagnostic output boundaries", () => {
  test("migration and nonce recovery fatal stderr sanitize synthetic credentials", async () => {
    const error = new Error(
      `request failed at https://user:${queryKey}@rpc.invalid/path?apiKey=${queryKey} `
      + `Authorization: Bearer ${bearer} private_key=${privateKey}`
    );
    const { lines } = await captureConsole(() => {
      reportMigrationSnapshotFailure(error);
      reportResolverNonceRecoveryFailure(error);
    });

    expectNoCanaries(lines);
    expect(JSON.stringify(lines)).toContain("https://rpc.invalid");
  });

  test("mission report child stdout and stderr sanitize object and serialized containers", async () => {
    const { lines } = await captureConsole(() => {
      emitSanitizedProcessOutput("info", JSON.stringify({ status: "healthy", serviceConfig: opaque }));
      emitSanitizedProcessOutput("error", JSON.stringify({ status: "failed", requestHeaders: { authorization: `Bearer ${bearer}` } }));
      emitSanitizedProcessOutput("error", JSON.stringify({ status: "failed", requestHeaders: opaque }));
    });

    expectNoCanaries(lines);
    expect(JSON.stringify(lines)).toContain("healthy");
    expect(JSON.stringify(lines)).toContain("failed");
  });

  test("mission report failures sanitize health state and logger output", async () => {
    const indexer = {
      pendingBattleReportMaterializationMissionIds() {
        throw new Error(
          `request failed at https://user:${queryKey}@rpc.invalid/path?apiKey=${queryKey} `
          + `Authorization: Bearer ${bearer} private_key=${privateKey}`
        );
      }
    } as unknown as SettlementIndexer;
    const service = new MissionReportGeneratorService(indexer, {
      databasePath: ":memory:",
      fromBlock: 0n,
      intervalMs: 1_000,
      batchSize: 1,
      concurrency: 1
    });
    const { lines } = await captureConsole(() => service.tick());
    const output = { snapshot: service.snapshot(), lines };

    expectNoCanaries(output);
    expect(JSON.stringify(output)).toContain("https://rpc.invalid");
    expect(service.snapshot().lastError).not.toBeNull();
  });
});
