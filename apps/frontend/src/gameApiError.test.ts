import { afterEach, expect, test } from "bun:test";
import { GameApiError } from "./gameApiError";
import { fetchGameApiJson } from "./walletFlow";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("API transport retains status, code and Retry-After even with custom UI text", async () => {
  globalThis.fetch = (async () => Response.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "12" } })) as unknown as typeof fetch;
  const error = await fetchGameApiJson("https://api.test/queues", "Queues", { httpErrorMessage: async () => "Please wait" }).catch(error => error);
  expect(error).toBeInstanceOf(GameApiError);
  expect(error).toMatchObject({ message: "Please wait", status: 429, code: "rate_limited", retryAfterMs: 12000, retryable: true });
});

test("Retry-After dates and invalid headers are parsed without changing retry policy", () => {
  const date = new Date(Date.now() + 60_000).toUTCString();
  const error = new GameApiError("Busy", { status: 503, retryAfter: date });
  expect(error.retryAfterMs).toBeGreaterThan(58_000);
  expect(error.retryAfterMs).toBeLessThanOrEqual(60_000);
  expect(new GameApiError("Invalid", { status: 400, retryAfter: "nonsense" })).toMatchObject({ retryable: false, retryAfterMs: undefined });
  expect(new GameApiError("Unauthorized", { status: 401 }).retryable).toBe(false);
});

test("non-JSON failures retain their HTTP status and network failures retain their cause", async () => {
  globalThis.fetch = (async () => new Response("bad request", { status: 400 })) as unknown as typeof fetch;
  const badRequest = await fetchGameApiJson("https://api.test/queues", "Queues").catch(error => error);
  expect(badRequest).toMatchObject({ status: 400, retryable: false, message: "Queues API failed: 400" });
  const cause = new TypeError("Offline");
  globalThis.fetch = (async () => { throw cause; }) as unknown as typeof fetch;
  const network = await fetchGameApiJson("https://api.test/queues", "Queues").catch(error => error);
  expect(network).toMatchObject({ cause, retryable: true, status: undefined });
});

test("cancellation stays a cancellation rather than a retryable transport error", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("Cancelled", "AbortError"));
  globalThis.fetch = (async (_input, options) => { options?.signal?.throwIfAborted(); return Response.json({}); }) as typeof fetch;
  const error = await fetchGameApiJson("https://api.test/queues", "Queues", { signal: controller.signal }).catch(error => error);
  expect(error).toMatchObject({ name: "AbortError" });
  expect(error).not.toBeInstanceOf(GameApiError);
});
