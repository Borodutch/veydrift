import { describe, expect, test } from "bun:test";
import { notifyPactInterest, PactInterestStore, validatePactInterest } from "./pactInterest";

describe("pact interest", () => {
  test("validates and normalizes submissions", () => {
    expect(validatePactInterest({ email: " Ann@Example.com ", amountUsd: "2500.4", telegram: "@ann_x" }))
      .toEqual({ email: "ann@example.com", amountUsd: 2500, telegram: "ann_x" });
    expect(validatePactInterest({ email: "nope", amountUsd: 1000 })).toBeString();
    expect(validatePactInterest({ email: "a@b.co", amountUsd: 999 })).toBeString();
    expect(validatePactInterest({ email: "a@b.co", amountUsd: 100_001 })).toBeString();
    expect(validatePactInterest({ email: "a@b.co", amountUsd: 1000, telegram: "bad handle!" })).toBeString();
    expect(validatePactInterest(null)).toBeString();
  });

  test("upserts by email", () => {
    const store = new PactInterestStore(":memory:");
    store.save({ email: "a@b.co", amountUsd: 1000, telegram: null });
    store.save({ email: "a@b.co", amountUsd: 5000, telegram: "ann" });
    expect(store.list()).toMatchObject([{ email: "a@b.co", amount_usd: 5000, telegram: "ann" }]);
  });
});

describe("POST /pact/interest", () => {
  test("stores a valid submission and rejects an invalid one", async () => {
    const { createRequestHandler } = await import("./server");
    const pactInterestStore = new PactInterestStore(":memory:");
    const handler = createRequestHandler({ pactInterestStore, enableResponseCache: false, logRequests: false } as never);
    const post = (body: unknown) => handler(new Request("http://localhost/pact/interest", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));
    expect((await post({ email: "a@b.co", amountUsd: 2000 })).status).toBe(200);
    expect((await post({ email: "bad", amountUsd: 2000 })).status).toBe(400);
    expect(pactInterestStore.list()).toMatchObject([{ email: "a@b.co", amount_usd: 2000 }]);
  });
});

describe("pact Telegram notification", () => {
  const interest = { email: "a@b.co", amountUsd: 5000, telegram: "ann" };

  test("sends the sign-up to the configured chat", async () => {
    const calls: Array<{ url: string; body: { chat_id: string; text: string } }> = [];
    const send = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}");
    }) as unknown as typeof fetch;
    await notifyPactInterest(interest, { VEYDRIFT_PACT_TELEGRAM_BOT_TOKEN: "t", VEYDRIFT_PACT_TELEGRAM_CHAT_ID: "42" }, send);
    expect(calls).toEqual([{
      url: "https://api.telegram.org/bott/sendMessage",
      body: { chat_id: "42", text: "New Pact sign-up\n$5,000 → 2,500,000 $VEYDRIFT\na@b.co\n@ann" },
    }]);
  });

  test("is skipped without config and never throws", async () => {
    let called = false;
    await notifyPactInterest(interest, {}, (async () => { called = true; return new Response(); }) as unknown as typeof fetch);
    expect(called).toBe(false);
    const failing = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
    await notifyPactInterest(interest, { VEYDRIFT_PACT_TELEGRAM_BOT_TOKEN: "t", VEYDRIFT_PACT_TELEGRAM_CHAT_ID: "42" }, failing);
  });
});
