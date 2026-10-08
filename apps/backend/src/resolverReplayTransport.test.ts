import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, parseTransaction, type Hex } from "viem";
import { replayMissionFixture, replayItems } from "./resolverReplayTransport.fixture";

async function fixture(run: (path: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "replay-transport-"));
  try { await run(join(dir, "journal.sqlite")); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function state(path: string) {
  const db = new Database(path);
  try { return { intent: db.query("SELECT send_attempts AS attempts, replay_state AS state, status FROM resolver_prepared_intents").get(),
    fences: db.query("SELECT token FROM resolver_send_fences").all() }; } finally { db.close(); }
}

test.each(["invalid sender", "invalid signature", "intrinsic gas too low", "execution reverted", "invalid chain id"])(
  "real viem wrapped deterministic rejection persists across restart: %s", async (reason) => {
  await fixture(async (path) => {
    const clock = { now: 1000 }; let sends = 0, mined = false, raw: Hex | undefined;
    const send = async (bytes: Hex): Promise<Hex> => { sends++; raw = bytes; throw { code: -32000, message: reason }; };
    const make = () => replayMissionFixture(path, send, clock, () => mined);
    const error = await make().resolveMissionBatch(replayItems).catch((e) => e);
    expect(error.message).toContain("deterministic send rejection"); expect(error.message).not.toContain(raw!);
    expect(state(path)).toEqual({ intent: { attempts: 1, state: "deterministic-rejection", status: "pending" }, fences: [] });
    clock.now += 60000;
    await expect(make().resolveMissionBatch([])).rejects.toThrow("operator review"); expect(sends).toBe(1);
    mined = true;
    expect(await make().resolveMissionBatch([])).toEqual({ hash: null, items: [], exclusions: [] });
    expect(sends).toBe(1); expect((state(path).intent as any).status).toBe("finalized");
  });
});

test.each(["already known", "nonce too low", "internal error", "connection reset"])(
  "real viem ambiguous rejection remains exact-byte retryable: %s", async (reason) => {
  await fixture(async (path) => {
    const bytes: Hex[] = [], clock = { now: 1000 };
    const send = async (raw: Hex): Promise<Hex> => { bytes.push(raw); throw { code: -32000, message: reason }; };
    await expect(replayMissionFixture(path, send, clock).resolveMissionBatch(replayItems)).rejects.toThrow("cooling down");
    expect(bytes.length).toBe(3); expect(new Set(bytes).size).toBe(1);
    expect(state(path)).toEqual({ intent: { attempts: 3, state: "retryable", status: "pending" }, fences: [] });
  });
});

test.each([false, true])("timed-out production replay retains cross-instance send fence (lease loss=%s)", async (leaseLoss) => {
  await fixture(async (path) => {
    const clock = { now: 1000 }; let sends = 0, active = 0, peak = 0, mined = false;
    let release!: () => void;
    const send = async (raw: Hex) => {
      sends++; active++; peak = Math.max(peak, active);
      try {
        if (sends === 1) throw { code: -32603, message: "internal error" };
        if (sends === 2) {
          if (leaseLoss) {
            const db = new Database(path);
            db.exec("UPDATE resolver_transaction_leases SET holder = 'expired-owner', expires_at_ms = 0"); db.close();
          }
          await new Promise<void>((resolve) => { release = resolve; });
        } else mined = true;
        return keccak256(raw);
      } finally { active--; }
    };
    const first = replayMissionFixture(path, send, clock, () => mined);
    await expect(first.resolveMissionBatch(replayItems)).rejects.toThrow("deadline");
    expect(active).toBe(1); expect(sends).toBe(2); expect(state(path).fences.length).toBe(1);
    clock.now += 1000000; // even far beyond the owner lease and retry timestamp
    const second = replayMissionFixture(path, send, clock, () => mined);
    await expect(second.resolveMissionBatch([])).rejects.toThrow("send still outstanding");
    expect(sends).toBe(2); expect(peak).toBe(1);
    release(); await new Promise((r) => setTimeout(r, 5));
    expect(state(path).fences).toEqual([]);
    expect(await second.resolveMissionBatch([])).toEqual({ hash: null, items: [], exclusions: [] });
    expect(sends).toBe(3); expect(peak).toBe(1); expect((state(path).intent as any).status).toBe("finalized");
  });
});

test("late wrapped deterministic result is retained before outstanding fence releases", async () => {
  await fixture(async (path) => {
    const clock = { now: 1000 }; let sends = 0;
    let reject!: (error: unknown) => void;
    const send = async (): Promise<Hex> => {
      if (++sends === 1) throw { code: -32603, message: "internal error" };
      return new Promise<Hex>((_resolve, r) => { reject = r; });
    };
    await expect(replayMissionFixture(path, send, clock).resolveMissionBatch(replayItems)).rejects.toThrow("deadline");
    reject({ code: -32000, message: "invalid sender" }); await new Promise((r) => setTimeout(r, 5));
    clock.now += 60000;
    await expect(replayMissionFixture(path, send, clock).resolveMissionBatch([])).rejects.toThrow("deterministic send rejection");
    expect(sends).toBe(2); expect(state(path).fences).toEqual([]);
  });
});

test("real crashed process cannot overlap; verified same-namespace exit resumes identical replay", async () => {
  await fixture(async (path) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "resolverReplayTransport.fixture.ts"), path],
      { stdout: "pipe", stderr: "pipe" });
    try {
      const reader = child.stdout.getReader(); let output = "";
      const ready = (async () => { while (!output.includes("outstanding")) {
        const next = await reader.read(); if (next.done) throw new Error("fixture exited before send");
        output += new TextDecoder().decode(next.value);
      } })();
      await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error("fixture timeout")), 3000))]);
      const db = new Database(path);
      const original = db.query("SELECT serialized_transaction AS raw, transaction_hash AS hash, nonce FROM resolver_prepared_intents").get() as { raw: Hex; hash: Hex; nonce: number };
      db.close();
      expect(original.nonce).toBe(4);
      expect(state(path)).toEqual({ intent: { attempts: 2, state: "retryable", status: "pending" }, fences: expect.any(Array) });
      expect(state(path).fences.length).toBe(1);
      const clock = { now: 1000000 }; let sends = 0, mined = false;
      const send = async (raw: Hex) => {
        sends++;
        expect(raw).toBe(original.raw); expect(keccak256(raw)).toBe(original.hash);
        expect(parseTransaction(raw).nonce).toBe(original.nonce);
        mined = true; return keccak256(raw);
      };
      const successor = replayMissionFixture(path, send, clock, () => mined);
      await expect(successor.resolveMissionBatch([])).rejects.toThrow("send still outstanding"); expect(sends).toBe(0);
      child.kill("SIGKILL"); await child.exited;
      expect(await successor.resolveMissionBatch([])).toEqual({ hash: null, items: [], exclusions: [] });
      expect(sends).toBe(1); expect(state(path).fences).toEqual([]);
      expect((state(path).intent as any).attempts).toBe(3);
      expect((state(path).intent as any).status).toBe("finalized");
    } finally { child.kill(); await child.exited; }
  });
});

test("foreign namespace orphan does not expire into an unproven concurrent resend", async () => {
  await fixture(async (path) => {
    const clock = { now: 1000 }; let sends = 0;
    const send = async (): Promise<Hex> => { sends++; throw { code: -32603, message: "internal error" }; };
    await expect(replayMissionFixture(path, send, clock).resolveMissionBatch(replayItems)).rejects.toThrow("cooling down");
    const db = new Database(path);
    db.exec("INSERT INTO resolver_send_fences SELECT chain_id,resolver_address,'foreign','other-namespace',1,transaction_hash FROM resolver_prepared_intents"); db.close();
    clock.now += 1000000;
    await expect(replayMissionFixture(path, send, clock).resolveMissionBatch([])).rejects.toThrow("foreign-host orphan requires explicit recovery");
    expect(sends).toBe(3); expect(state(path).fences.length).toBe(1);
  });
});
