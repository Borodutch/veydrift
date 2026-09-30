import { describe, expect, test } from "bun:test";
import { PactInterestStore, validatePactInterest } from "./pactInterest";

describe("pact interest", () => {
  test("validates and normalizes submissions", () => {
    expect(validatePactInterest({ email: " Ann@Example.com ", amountUsd: "2500.4", telegram: "@ann_x" }))
      .toEqual({ email: "ann@example.com", amountUsd: 2500, telegram: "ann_x" });
    expect(validatePactInterest({ email: "nope", amountUsd: 1000 })).toBeString();
    expect(validatePactInterest({ email: "a@b.co", amountUsd: 5 })).toBeString();
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
