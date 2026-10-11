import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, stringToHex } from "viem";

import { BattleReportStore } from "./battleReferee";
import type { BackendConfig } from "./config";
import { createRequestHandler } from "./server";

const directory = mkdtempSync(join(tmpdir(), "battle-report-route-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test("serves immutable referee reports by onchain hash and by battle id", async () => {
  const path = join(directory, "battle-referee.sqlite");
  const report = JSON.stringify({ format: "veydrift.referee-battle.report.v1", battleId: "42", rounds: [] });
  const reportHash = keccak256(stringToHex(report));
  new BattleReportStore(path).saveReport(42n, reportHash, report);
  const handler = createRequestHandler({
    role: "reader",
    indexer: { snapshot: () => ({}) } as never,
    chainReader: {} as never,
    config: {
      chainId: 84532, deploymentMode: "test", qaSyntheticStationedDefenders: false, indexDbPath: ":memory:",
      randomnessCommitmentStorePath: join(directory, "randomness.json"), indexFromBlock: 0n,
      missionResolutionEnabled: false, resourceTokenAddresses: {}, rpcSource: "custom-url", rpcUrl: "https://example.invalid/rpc",
      wsRpcSource: "missing", gameContractAddress: "0x3333333333333333333333333333333333333333",
      battleRefereeStorePath: path
    } as BackendConfig
  });

  const byHash = await handler(new Request(`http://localhost/battle-reports/${reportHash.toUpperCase().replace("0X", "0x")}`));
  expect(byHash.status).toBe(200);
  expect(await byHash.text()).toBe(report);
  expect(byHash.headers.get("x-veydrift-report-hash")).toBe(reportHash);

  const byBattle = await handler(new Request("http://localhost/battles/42/report"));
  expect(await byBattle.text()).toBe(report);
  expect(byBattle.headers.get("x-veydrift-report-hash")).toBe(reportHash);

  expect((await handler(new Request(`http://localhost/battle-reports/0x${"0".repeat(64)}`))).status).toBe(404);
  expect((await handler(new Request("http://localhost/battles/43/report"))).status).toBe(404);
});
