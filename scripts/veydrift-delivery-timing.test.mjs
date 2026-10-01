import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { deliveryContext, deliverySample, timedJsonRequest } from "./veydrift-delivery-timing.mjs";

test("context never exposes proxy values or claims they were used", () => {
  const context = deliveryContext({ HTTPS_PROXY: "https://user:canary@private.invalid", NO_PROXY: "private-host-canary" });
  assert.equal(context.proxyEnvironmentPresent, true);
  assert.equal(context.proxyBypassEnvironmentPresent, true);
  assert.equal(context.proxyUsage, "not-observable-from-fetch");
  assert.equal(JSON.stringify(context).includes("canary"), false);
  assert.equal(deliveryContext({}).proxyEnvironmentPresent, false);
});

test("separates delayed response headers and body; counts UTF-8 bytes", async () => {
  const payload = JSON.stringify({ message: "🫡" });
  const sample = await timedJsonRequest("http://fixture.invalid", 1000, async () => {
    await delay(25);
    return { status: 200, ok: true, text: async () => { await delay(30); return payload; } };
  });
  assert.equal(sample.ok, true);
  assert.ok(sample.responseReadyMs >= 15);
  assert.ok(sample.bodyReadMs >= 20);
  assert.ok(sample.ms >= 45);
  assert.equal(sample.bytes, Buffer.byteLength(payload));
  assert.ok(Number.isFinite(Date.parse(sample.startedAt)));
  assert.equal(Object.hasOwn(deliverySample(sample), "body"), false);
});

test("preserves non-2xx, invalid JSON and network failures", async () => {
  const denied = await timedJsonRequest("http://fixture.invalid", 100, async () => new Response('{"error":"busy"}', { status: 429 }));
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 429);
  const invalid = await timedJsonRequest("http://fixture.invalid", 100, async () => new Response("not JSON", { status: 502 }));
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 502);
  assert.equal(invalid.bytes, 8);
  assert.equal(invalid.timedOut, false);
  const failed = await timedJsonRequest("http://fixture.invalid", 100, async () => { throw new Error("aborted by peer, not our deadline"); });
  assert.equal(failed.status, null);
  assert.equal(failed.responseReadyMs, null);
  assert.equal(failed.timedOut, false);
});

test("deadline applies before headers and during body; retains received status", async () => {
  for (const bodyPhase of [false, true]) {
    const sample = await timedJsonRequest("http://fixture.invalid", 20, async (_url, { signal }) => {
      const wait = () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("deadline")), { once: true }));
      if (!bodyPhase) return await wait();
      return { status: 200, ok: true, text: wait };
    });
    assert.equal(sample.ok, false);
    assert.equal(sample.timedOut, true);
    assert.equal(sample.status, bodyPhase ? 200 : null);
    assert.equal(sample.bodyReadMs, null);
    assert.equal(sample.bytes, null);
  }
});

test("smoke keeps the default 500ms gate and persists failed sample timings", async (context) => {
  const server = createServer(async (request, response) => {
    let body;
    if (request.url === "/health") body = { ok: true, configured: true };
    else if (request.url === "/runtime-config") {
      await delay(550);
      body = { featureSupport: { researchEndpoint: true, highscoresEndpoint: true }, privatePayload: "body-canary" };
    } else if (request.url.startsWith("/highscores")) body = { rankings: {} };
    else body = { planets: [] };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => { server.closeAllConnections(); server.close(); });
  const child = spawn(process.execPath, ["scripts/veydrift-postdeploy-smoke.mjs", "--api-url",
    "http://127.0.0.1:" + server.address().port, "--runtime-stress-rounds", "2"], {
    env: { ...process.env, NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"], timeout: 15000
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  assert.equal(code, 1, stderr);
  const result = JSON.parse(stdout);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /runtime-config stress p95 .* exceeded 500ms/);
  const stress = result.evidence.find((entry) => entry.name === "runtime-config-stress");
  assert.equal(stress.runtimeSamples.length, 2);
  assert.deepEqual(stress.runtimeStatuses, [200, 200]);
  assert.ok(stress.runtimeSamples.every((sample) => sample.responseReadyMs >= 500));
  assert.equal(stdout.includes("body-canary"), false);
  assert.equal(result.deliveryContext.proxyUsage, "not-observable-from-fetch");
});
