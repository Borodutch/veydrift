import { describe, expect, test } from "bun:test";
import { CcaInterestStore, notifyCcaInterest, validateCcaInterest } from "./ccaInterest";

describe("CCA interest", () => {
  test("validates and normalizes submissions, with the amount optional", () => {
    expect(validateCcaInterest({ email: " Ann@Example.com ", amountUsd: "2500.4", telegram: "@ann_x" }))
      .toEqual({ email: "ann@example.com", amountUsd: 2500, telegram: "ann_x" });
    expect(validateCcaInterest({ email: "a@b.co" })).toEqual({ email: "a@b.co", amountUsd: 0, telegram: null });
    expect(validateCcaInterest({ email: "a@b.co", amountUsd: "" })).toMatchObject({ amountUsd: 0 });
    expect(validateCcaInterest({ email: "nope", amountUsd: 1000 })).toBeString();
    expect(validateCcaInterest({ email: "a@b.co", amountUsd: -1 })).toBeString();
    expect(validateCcaInterest({ email: "a@b.co", amountUsd: "lots" })).toBeString();
    expect(validateCcaInterest({ email: "a@b.co", amountUsd: 10_000_001 })).toBeString();
    expect(validateCcaInterest({ email: "a@b.co", amountUsd: 1000, telegram: "bad handle!" })).toBeString();
    expect(validateCcaInterest(null)).toBeString();
  });

  test("upserts by email and totals from $0", () => {
    const store = new CcaInterestStore(":memory:");
    expect(store.totals()).toEqual({ people: 0, amountUsd: 0 });
    store.save({ email: "a@b.co", amountUsd: 1000, telegram: null });
    store.save({ email: "a@b.co", amountUsd: 5000, telegram: "ann" });
    store.save({ email: "c@d.co", amountUsd: 0, telegram: null });
    expect(store.list().sort((a, b) => a.email.localeCompare(b.email)))
      .toMatchObject([{ email: "a@b.co", amount_usd: 5000, telegram: "ann" }, { email: "c@d.co", amount_usd: 0 }]);
    expect(store.totals()).toEqual({ people: 2, amountUsd: 5000 });
  });
});

describe("/cca/interest", () => {
  test("stores a valid submission, rejects an invalid one and reports totals", async () => {
    const { createRequestHandler } = await import("./server");
    const ccaInterestStore = new CcaInterestStore(":memory:");
    const handler = createRequestHandler({ ccaInterestStore, enableResponseCache: false, logRequests: false } as never);
    const post = (body: unknown) => handler(new Request("http://localhost/cca/interest", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));
    expect(await (await handler(new Request("http://localhost/cca/interest"))).json()).toEqual({ people: 0, amountUsd: 0 });
    expect((await post({ email: "a@b.co", amountUsd: 2000 })).status).toBe(200);
    expect((await post({ email: "e@f.co" })).status).toBe(200);
    expect((await post({ email: "bad", amountUsd: 2000 })).status).toBe(400);
    expect(await (await handler(new Request("http://localhost/cca/interest"))).json()).toEqual({ people: 2, amountUsd: 2000 });
    expect((await handler(new Request("http://localhost/pact/interest", { body: "{}", method: "POST" }))).status).toBe(404);
  });
});

describe("CCA interest Telegram notification", () => {
  const interest = { email: "a@b.co", amountUsd: 5000, telegram: "ann" };
  const env = { VEYDRIFT_PACT_TELEGRAM_BOT_TOKEN: "t", VEYDRIFT_PACT_TELEGRAM_CHAT_ID: "42" };

  test("sends the sign-up to the configured chat", async () => {
    const calls: Array<{ url: string; body: { chat_id: string; text: string } }> = [];
    const send = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}");
    }) as unknown as typeof fetch;
    await notifyCcaInterest(interest, env, send);
    await notifyCcaInterest({ email: "c@d.co", amountUsd: 0, telegram: null }, env, send);
    expect(calls).toEqual([
      { url: "https://api.telegram.org/bott/sendMessage", body: { chat_id: "42", text: "New CCA interest\n$5,000\na@b.co\n@ann" } },
      { url: "https://api.telegram.org/bott/sendMessage", body: { chat_id: "42", text: "New CCA interest\nNo amount given\nc@d.co" } },
    ]);
  });

  test("is skipped without config and never throws", async () => {
    let called = false;
    await notifyCcaInterest(interest, {}, (async () => { called = true; return new Response(); }) as unknown as typeof fetch);
    expect(called).toBe(false);
    const failing = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
    await notifyCcaInterest(interest, env, failing);
  });
});
