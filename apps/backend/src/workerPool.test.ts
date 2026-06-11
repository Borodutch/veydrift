import { describe, expect, test } from "bun:test";
import {
  resolveWorkerAssignment,
  resolveWorkerCount,
  roleForIndex,
  WORKER_COUNT_ENV,
  WORKER_INDEX_ENV,
  WORKER_ROLE_ENV
} from "./workerPool";

describe("resolveWorkerCount", () => {
  test("uses the host CPU count when no override is set", () => {
    expect(resolveWorkerCount({}, 8)).toBe(8);
  });

  test("floors fractional CPU counts and never returns less than 1", () => {
    expect(resolveWorkerCount({}, 4.9)).toBe(4);
    expect(resolveWorkerCount({}, 0)).toBe(1);
    expect(resolveWorkerCount({}, Number.NaN)).toBe(1);
  });

  test("honors a positive integer override", () => {
    expect(resolveWorkerCount({ [WORKER_COUNT_ENV]: "3" }, 16)).toBe(3);
    expect(resolveWorkerCount({ [WORKER_COUNT_ENV]: "1" }, 16)).toBe(1);
  });

  test("ignores blank or invalid overrides and falls back to CPU count", () => {
    expect(resolveWorkerCount({ [WORKER_COUNT_ENV]: "" }, 6)).toBe(6);
    expect(resolveWorkerCount({ [WORKER_COUNT_ENV]: "   " }, 6)).toBe(6);
    expect(resolveWorkerCount({ [WORKER_COUNT_ENV]: "0" }, 6)).toBe(6);
    expect(resolveWorkerCount({ [WORKER_COUNT_ENV]: "-2" }, 6)).toBe(6);
    expect(resolveWorkerCount({ [WORKER_COUNT_ENV]: "abc" }, 6)).toBe(6);
  });
});

describe("roleForIndex", () => {
  test("worker 0 is the single writer, the rest are readers", () => {
    expect(roleForIndex(0)).toBe("writer");
    expect(roleForIndex(1)).toBe("reader");
    expect(roleForIndex(7)).toBe("reader");
  });
});

describe("resolveWorkerAssignment", () => {
  test("a process without a role env is the supervisor sized to the pool", () => {
    expect(resolveWorkerAssignment({}, 4)).toEqual({ kind: "supervisor", workerCount: 4 });
    expect(resolveWorkerAssignment({ [WORKER_COUNT_ENV]: "2" }, 16)).toEqual({
      kind: "supervisor",
      workerCount: 2
    });
  });

  test("a spawned writer worker is identified with its index", () => {
    expect(
      resolveWorkerAssignment({ [WORKER_ROLE_ENV]: "writer", [WORKER_INDEX_ENV]: "0" }, 4)
    ).toEqual({ kind: "worker", role: "writer", index: 0 });
  });

  test("a spawned reader worker is identified with its index", () => {
    expect(
      resolveWorkerAssignment({ [WORKER_ROLE_ENV]: "reader", [WORKER_INDEX_ENV]: "3" }, 4)
    ).toEqual({ kind: "worker", role: "reader", index: 3 });
  });

  test("defaults a worker index to 0 when missing or malformed", () => {
    expect(resolveWorkerAssignment({ [WORKER_ROLE_ENV]: "reader" }, 4)).toEqual({
      kind: "worker",
      role: "reader",
      index: 0
    });
    expect(
      resolveWorkerAssignment({ [WORKER_ROLE_ENV]: "reader", [WORKER_INDEX_ENV]: "nope" }, 4)
    ).toEqual({ kind: "worker", role: "reader", index: 0 });
  });

  test("an unrecognized role env is treated as the supervisor", () => {
    expect(resolveWorkerAssignment({ [WORKER_ROLE_ENV]: "bogus" }, 4)).toEqual({
      kind: "supervisor",
      workerCount: 4
    });
  });
});
