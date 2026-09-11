import { expect, test } from "bun:test";
import { BackendDataStore } from "./backendDataStore";
import { transactionActionNotice } from "./useTransactionAction";
import type { WriteTransactionState } from "./transactionActionGate";

test("transaction notices use one phase mapping", () => {
  expect(transactionActionNotice(undefined)).toEqual({ status: "idle" });
  for (const phase of ["pending", "confirming", "confirmed", "indexing"] as const) {
    expect(transactionActionNotice({ phase, label: "Processing…" })).toEqual({ status: "pending", label: "Processing…" });
  }
  expect(transactionActionNotice({ phase: "success" }).status).toBe("success");
  expect(transactionActionNotice({ phase: "error", label: "Rejected" })).toEqual({ status: "error", label: "Rejected" });
});

test("action selectors stay scoped by wallet, feature, and planet through completion", async () => {
  let release!: () => void;
  const receipt = new Promise<void>(resolve => { release = resolve; });
  const store = new BackendDataStore("https://action-selector.test", {
    transactionStatusReader: async hash => {
      if (hash === "0xfirst") await receipt;
      return { transactionHash: hash, phase: "applied", receiptBlock: "1", latestIndexedBlock: "1", indexedEventCount: 0, events: [] };
    },
  });
  const read = (wallet: string, planet: string) => store.snapshot<WriteTransactionState>(store.writeTransactionKey("group:building", wallet, planet))?.data;
  try {
    const first = store.runWriteTransaction({ key: "building:start:mine", label: "Build", invalidateTags: ["wallet:0xabc", "planet:7"], send: async () => "0xfirst" });
    for (let i = 0; i < 50 && !read("0xabc", "7")?.txHash; i++) await Bun.sleep(1);
    expect(transactionActionNotice(read("0xabc", "7")).status).toBe("pending");
    await store.runWriteTransaction({ key: "building:start:mine", label: "Build", invalidateTags: ["wallet:0xabc", "planet:8"], send: async () => "0xsecond" });
    expect(transactionActionNotice(read("0xabc", "8")).status).toBe("success");
    expect(transactionActionNotice(read("0xabc", "7")).status).toBe("pending");
    expect(read("0xother", "7")).toBeUndefined();
    expect(store.snapshot(store.writeTransactionKey("group:shipyard", "0xabc", "7"))).toBeUndefined();
    release();
    await first;
    expect(transactionActionNotice(read("0xabc", "7")).status).toBe("success");
  } finally {
    release();
    store.dispose();
  }
});
