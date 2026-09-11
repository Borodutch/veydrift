import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { apiRequestEvent, createRequestLoggingFetch } from "./observability";

let info: ReturnType<typeof spyOn>;
let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
  info = spyOn(console, "info").mockImplementation(() => {});
  warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { info.mockRestore(); warn.mockRestore(); });

test("logs UTF-8 payload bytes without consuming requests or changing responses", async () => {
  const text = "private-🌒";
  const bytes = Buffer.byteLength(text);
  const request = new Request("http://localhost/echo", {
    method: "POST", body: text, headers: { "content-length": String(bytes) }
  });
  const handler = createRequestLoggingFetch(async (received) => {
    expect(received).toBe(request);
    expect(received.bodyUsed).toBe(false);
    return new Response(await received.text(), { status: 201, headers: { "x-proof": "retained" } });
  }, "reader");
  const response = await handler(request);
  expect(info).not.toHaveBeenCalled();
  expect(response.status).toBe(201);
  expect(response.headers.get("x-proof")).toBe("retained");
  expect(await response.text()).toBe(text);
  expect(info).toHaveBeenCalledTimes(1);
  const entry = JSON.parse(String(info.mock.calls[0]![0]));
  expect(entry).toMatchObject({ requestBodyBytes: bytes, responseBodyBytes: bytes, responseBodyComplete: true });
  expect(JSON.stringify(entry)).not.toContain(text);
});

test("unknown or malformed declared request lengths remain null", () => {
  for (const length of [undefined, "", "-1", "1.5", "3garbage", "9007199254740992"]) {
    const request = new Request("http://localhost/post", {
      method: "POST", body: "abc", headers: length === undefined ? {} : { "content-length": length }
    });
    expect(apiRequestEvent(request, new URL(request.url), "reader", 200, 0).requestBodyBytes).toBeNull();
    expect(request.bodyUsed).toBe(false);
  }
});

test("bodyless responses and HEAD log zero bytes immediately", async () => {
  for (const method of ["GET", "HEAD"]) {
    const response = await createRequestLoggingFetch(async () => new Response(null, { status: 204 }), "reader")(
      new Request("http://localhost/empty", { method })
    );
    expect(response.status).toBe(204);
    expect(JSON.parse(String(info.mock.calls.at(-1)![0]))).toMatchObject({
      requestBodyBytes: 0, responseBodyBytes: 0, responseBodyComplete: true
    });
  }
});

test("open SSE is returned untouched and logged immediately with unknown size", async () => {
  const upstream = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("event: ready\n\n")); } }), {
    headers: { "content-type": "text/event-stream" }
  });
  const response = await createRequestLoggingFetch(async () => upstream, "writer")(new Request("http://localhost/chain/events"));
  expect(response).toBe(upstream);
  expect(info).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(info.mock.calls[0]![0]))).toMatchObject({ stream: true, responseBodyBytes: null, responseBodyComplete: false });
  await response.body!.cancel();
});

test("counts streamed chunks with backpressure and propagates cancellation once", async () => {
  let pulls = 0;
  let cancelled: unknown;
  const upstream = new ReadableStream<Uint8Array>({
    pull(c) { pulls++; c.enqueue(new Uint8Array([1, 2, 3])); },
    cancel(reason) { cancelled = reason; }
  }, { highWaterMark: 0 });
  const response = await createRequestLoggingFetch(async () => new Response(upstream), "reader")(new Request("http://localhost/data"));
  expect(pulls).toBe(0);
  const reader = response.body!.getReader();
  expect((await reader.read()).value).toEqual(new Uint8Array([1, 2, 3]));
  expect(pulls).toBe(1);
  await reader.cancel("client disconnected");
  expect(cancelled).toBe("client disconnected");
  expect(info).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(info.mock.calls[0]![0]))).toMatchObject({ responseBodyBytes: 3, responseBodyComplete: false });
});

test("stream failures log partial sizes and still reject the body read", async () => {
  let pulls = 0;
  const response = await createRequestLoggingFetch(async () => new Response(new ReadableStream<Uint8Array>({
    pull(c) { if (pulls++ === 0) c.enqueue(new Uint8Array([1, 2])); else c.error(new Error("broken stream")); }
  }, { highWaterMark: 0 })), "reader")(new Request("http://localhost/data"));
  await expect(response.arrayBuffer()).rejects.toThrow("broken stream");
  expect(info).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(info.mock.calls[0]![0]))).toMatchObject({ responseBodyBytes: 2, responseBodyComplete: false });
});

test("handler failures retain the original error and unknown response size", async () => {
  const failure = new Error("handler failed");
  const handler = createRequestLoggingFetch(async () => { throw failure; }, "writer");
  await expect(handler(new Request("http://localhost/data"))).rejects.toBe(failure);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(warn.mock.calls[0]![0]))).toMatchObject({ status: 500, responseBodyBytes: null, responseBodyComplete: false });
});
