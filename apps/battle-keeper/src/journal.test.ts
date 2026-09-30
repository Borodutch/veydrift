import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeeperJournal } from "./journal";
import { BattleKeeper, type KeeperLogger, type PendingMission } from "./keeper";
import { FleetMissionStatus, MissionType } from "./events";
import type { MissionResolver } from "./resolver";

const silent: KeeperLogger = { info() {}, warn() {}, error() {} };
const pending: PendingMission = { missionId: "919", missionType: MissionType.Attack,
  leg: "arrival", dueAt: 10, returnAt: 20 };

function fixture(run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "keeper-journal-"));
  try { run(join(dir, "state.sqlite")); } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("KeeperJournal", () => {
  test("WAL commit reopens with jobs and cursor; repeated receipts overwrite rather than duplicate", () => {
    fixture((path) => {
      let journal = new KeeperJournal(path, "8453:game");
      journal.commitBatch(100n, () => { journal.put(pending); journal.put(pending); });
      journal.close();
      journal = new KeeperJournal(path, "8453:game");
      expect(journal.load()).toEqual([pending]);
      expect(journal.nextBlock()).toBe(100n);
      journal.commitBatch(101n, () => journal.put({ ...pending, leg: "return", dueAt: 200, returnAt: 200 }));
      expect(journal.load()).toHaveLength(1);
      journal.remove(pending.missionId);
      journal.remove(pending.missionId);
      journal.close();
      journal = new KeeperJournal(path, "8453:game");
      expect(journal.load()).toEqual([]);
      expect(journal.nextBlock()).toBe(101n);
      journal.close();
    });
  });

  test("failed batch atomically rolls back pending changes and cursor, disables signing until restart", () => {
    fixture((path) => {
      let journal = new KeeperJournal(path, "8453:game");
      journal.commitBatch(100n, () => journal.put(pending));
      expect(() => journal.commitBatch(200n, () => {
        journal.remove(pending.missionId);
        journal.put({ ...pending, missionId: "920" });
        throw new Error("interrupted batch");
      })).toThrow("interrupted batch");
      expect(() => journal.assertHealthy()).toThrow("signing disabled");
      journal.close();
      journal = new KeeperJournal(path, "8453:game");
      expect(journal.load()).toEqual([pending]);
      expect(journal.nextBlock()).toBe(100n);
      journal.close();
    });
  });

  test("a different chain/game cannot reuse discovery state", () => {
    fixture((path) => {
      new KeeperJournal(path, "8453:game").close();
      expect(() => new KeeperJournal(path, "84532:game")).toThrow("different chain/game");
    });
  });
});

test("durable battle survives old launch restart and canonical terminal cleanup avoids paid duplicate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "keeper-restart-"));
  const path = join(dir, "state.sqlite");
  let journal = new KeeperJournal(path, "8453:game");
  let sent = 0;
  let state: number = FleetMissionStatus.Outbound;
  const resolver: MissionResolver = {
    keeperAddress: () => "0xkeeper",
    resolveMission: async () => { sent++; return "0xreceipt"; },
    missionStatus: async (missionId) => ({ missionId, status: state,
      missionType: MissionType.Attack, arrivalAt: 10, returnAt: 20, randomnessRequestId: "9" })
  };
  try {
    let keeper = new BattleKeeper(resolver, { journal, now: () => 1_000_000, logger: silent });
    keeper.recordLaunched({ missionId: "919", missionType: MissionType.Attack, arrivalAt: 10, returnAt: 20 });
    await keeper.tick();
    expect(sent).toBe(1);
    journal.close();
    journal = new KeeperJournal(path, "8453:game");
    keeper = new BattleKeeper(resolver, { journal, now: () => 1_000_000, logger: silent });
    expect(keeper.snapshot().awaitingArrivalCount).toBe(1);
    await keeper.tick();
    expect(sent).toBe(2);
    // A different permissionless resolver finalized while this keeper was stopped.
    journal.close();
    state = FleetMissionStatus.Resolved;
    journal = new KeeperJournal(path, "8453:game");
    keeper = new BattleKeeper(resolver, { journal, now: () => 1_000_000, logger: silent });
    await keeper.tick();
    expect(sent).toBe(2);
    expect(journal.load()).toEqual([]);
    keeper.recordArrivalResolved({ missionId: "919", missionType: MissionType.Attack, returnAt: 0 });
    keeper.recordReturned("919");
    expect(journal.load()).toEqual([]);
  } finally { journal.close(); rmSync(dir, { recursive: true, force: true }); }
});


test("process death inside SQLite batch preserves previous jobs and cursor", () => {
  fixture((path) => {
    let journal = new KeeperJournal(path, "8453:game");
    journal.commitBatch(100n, () => journal.put(pending));
    journal.close();
    const script = [
      "import { KeeperJournal } from " + JSON.stringify(join(import.meta.dir, "journal.ts")) + ";",
      "const journal = new KeeperJournal(" + JSON.stringify(path) + ", '8453:game');",
      "journal.commitBatch(200n, () => { journal.remove('919'); process.exit(0); });"
    ].join("\n");
    const child = Bun.spawnSync([process.execPath, "-e", script]);
    expect(child.exitCode).toBe(0);
    journal = new KeeperJournal(path, "8453:game");
    expect(journal.load()).toEqual([pending]);
    expect(journal.nextBlock()).toBe(100n);
    journal.close();
  });
});


test("durable noncombat arrival and return can also wait on lazy staged combat without losing their jobs", async () => {
  const journal = new KeeperJournal(":memory:", "8453:game");
  let calls = 0;
  let state: number = FleetMissionStatus.Outbound;
  const resolver: MissionResolver = {
    keeperAddress: () => "0xkeeper",
    resolveMission: async () => { calls++; return "0xchunk"; },
    missionStatus: async (missionId) => ({ missionId, status: state, missionType: MissionType.Transport,
      arrivalAt: 10, returnAt: 20, randomnessRequestId: "0" })
  };
  try {
    const keeper = new BattleKeeper(resolver, { journal, now: () => 100, logger: silent });
    keeper.recordLaunched({ missionId: "920", missionType: MissionType.Transport, arrivalAt: 10, returnAt: 20 });
    await keeper.tick();
    expect(keeper.snapshot().resolvedCount).toBe(0);
    expect(journal.load()[0]?.leg).toBe("arrival");
    state = FleetMissionStatus.Returning;
    await keeper.tick(); // pre-send reconciliation discovers the return; no arrival duplicate
    expect(calls).toBe(1);
    await keeper.tick(); // receipt only advances a dependency, not this return
    expect(calls).toBe(2);
    expect(keeper.snapshot().resolvedCount).toBe(0);
    expect(journal.load()[0]?.leg).toBe("return");
    state = FleetMissionStatus.Returned;
    await keeper.tick();
    expect(calls).toBe(2);
    expect(journal.load()).toEqual([]);
  } finally { journal.close(); }
});
