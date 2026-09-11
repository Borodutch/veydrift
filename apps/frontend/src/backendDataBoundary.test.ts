import { expect, test } from "bun:test";
import { BackendDataStore } from "./backendDataStore";

const frontendRoot = new URL("..", import.meta.url).pathname;

// Static checks enforce ownership boundaries; behavior belongs in runtime tests.
test("UI components cannot bypass the data store or own transaction submissions", async () => {
  const violations: string[] = [];
  for await (const file of new Bun.Glob("src/**/*.tsx").scan({ cwd: frontendRoot })) {
    const source = await Bun.file(`${frontendRoot}/${file}`).text();
    if (/\bfetch\s*\(/.test(source)
      || /eth_sendTransaction/.test(source)
      || /\.(?:commitBackendSnapshot|markBackendFailure|discardBackendSnapshot)\(/.test(source)
      || /from ["'][^"']*gameStateStore["']/.test(source)) violations.push(file);
  }
  expect(violations).toEqual([]);
});

test("only the canonical store owns cache primitives and only the wallet adapter submits transactions", async () => {
  const violations: string[] = [];
  let submissionGateways = 0;
  for await (const file of new Bun.Glob("src/**/*.{ts,tsx}").scan({ cwd: frontendRoot })) {
    if (/\.test\.tsx?$/.test(file)) continue;
    const source = await Bun.file(`${frontendRoot}/${file}`).text();
    if (!["src/backendDataStore.ts", "src/gameStateStore.ts"].includes(file)
      && (/\.(?:publish|fail|clear)\(/.test(source) || /\/index\/(?:rebuild|verify)/.test(source))) violations.push(file);
    const submissions = source.match(/method:\s*["']eth_sendTransaction["']/g) ?? [];
    if (submissions.length && file !== "src/walletFlow.ts") violations.push(file);
    submissionGateways += submissions.length;
  }
  expect(violations).toEqual([]);
  expect(submissionGateways).toBe(1);
});

test("descriptor and imperative callers share one transport and one canonical snapshot", async () => {
  const originalFetch = globalThis.fetch;
  const store = new BackendDataStore("https://api.test");
  let release!: (response: Response) => void;
  let requests = 0;
  globalThis.fetch = (() => {
    requests += 1;
    return new Promise<Response>(resolve => { release = resolve; });
  }) as unknown as typeof fetch;
  try {
    const query = store.queries.planets("0xabc");
    const first = query.read();
    const others = Array.from({ length: 9 }, () => store.planets("0xabc"));
    await Promise.resolve();
    expect(requests).toBe(1);
    const payload = { wallet: "0xabc", planets: [] };
    release(Response.json(payload));
    await Promise.all([first, ...others]);
    expect(store.snapshot(query.key)?.data).toEqual(payload);
  } finally {
    store.dispose();
    globalThis.fetch = originalFetch;
  }
});

test("an unrelated slow query cannot block another wallet, and disposal aborts its transport", async () => {
  const originalFetch = globalThis.fetch;
  const store = new BackendDataStore("https://api.test");
  let slowSignal: AbortSignal | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("0xaaa")) {
      slowSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => slowSignal?.addEventListener("abort", () => reject(slowSignal?.reason), { once: true }));
    }
    return Response.json({ wallet: "0xbbb", planets: [] });
  }) as typeof fetch;
  try {
    const slow = store.queries.planets("0xaaa").read().catch(() => undefined);
    await expect(store.planets("0xbbb")).resolves.toMatchObject({ wallet: "0xbbb" });
    expect(slowSignal?.aborted).toBe(false);
    store.dispose();
    expect(slowSignal?.aborted).toBe(true);
    await slow;
  } finally {
    store.dispose();
    globalThis.fetch = originalFetch;
  }
});

test("failed refresh preserves the descriptor's last good data", async () => {
  const originalFetch = globalThis.fetch;
  const store = new BackendDataStore("https://api.test");
  let fail = false;
  globalThis.fetch = (async () => fail ? new Response("Unavailable", { status: 503 }) : Response.json({ wallet: "0xabc", planets: [] })) as unknown as typeof fetch;
  try {
    const query = store.queries.planets("0xabc");
    const previous = await query.read();
    fail = true;
    await expect(store.planets("0xabc")).rejects.toThrow();
    expect(store.snapshot(query.key)?.data).toEqual(previous);
    expect(store.snapshot(query.key)?.error).toBeDefined();
  } finally {
    store.dispose();
    globalThis.fetch = originalFetch;
  }
});
