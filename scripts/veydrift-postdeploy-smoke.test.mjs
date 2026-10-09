import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";

const wallet = "0x1111111111111111111111111111111111111111";
const accept = "application/json; resource-view=nullable-v1";
const planet = {
  id: "1",
  resources: null,
  resourcesAsOfNow: null,
  currentResources: null,
  raidableResources: null
};

function fixture(pathname) {
  if (pathname === "/health") return { ok: true, configured: true };
  if (pathname === "/runtime-config") return { featureSupport: { researchEndpoint: true, highscoresEndpoint: true } };
  if (pathname.startsWith("/universe/")) return { planets: [planet] };
  if (pathname === "/highscores") return { rankings: { planets: [planet] } };
  if (pathname.endsWith("/settlement")) return { wallet, homePlanetId: "1" };
  if (pathname.endsWith("/planets")) return { planets: [planet] };
  if (pathname.endsWith("/fleet-visibility")) return { outgoing: [], incoming: [], returning: [] };
  if (pathname.endsWith("/moon")) return { moon: null };
  return { resources: null };
}

async function runSmoke(context, override = () => ({}), args = []) {
  const requests = [];
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    requests.push({ url: request.url, accept: request.headers.accept });
    const { status = 200, body = fixture(pathname), delay = 0 } = override(pathname);
    const reply = () => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (delay) {
      const timer = setTimeout(reply, delay);
      response.on("close", () => clearTimeout(timer));
    } else reply();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => { server.closeAllConnections(); server.close(); });
  const child = spawn(process.execPath, [
    "scripts/veydrift-postdeploy-smoke.mjs",
    "--api-url", "http://127.0.0.1:" + server.address().port,
    "--runtime-stress-rounds", "1",
    ...args
  ], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15000
  });
  context.after(() => { if (child.exitCode === null) child.kill(); });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  assert.equal(stderr, "");
  return { code, report: JSON.parse(stdout), requests };
}

test("all ordinary, wallet and stress requests negotiate nullable resources", async (context) => {
  const { code, report, requests } = await runSmoke(context, (pathname) => ({ body: fixture(pathname) }), ["--wallet", wallet]);
  assert.equal(code, 0, JSON.stringify(report.failures));
  assert.equal(report.ok, true);
  assert.deepEqual(report.failures, []);
  assert.equal(requests.length, 19);
  assert.ok(requests.every((request) => request.accept === accept));
  assert.ok(requests.some((request) => request.url.includes("/overview?planetId=1")));
  assert.equal(report.evidence.find((entry) => entry.name === "rankings").status, 200);
});

for (const status of [429, 500, 503]) {
  test("HTTP " + status + " still fails ordinary and noisy stress checks", async (context) => {
    const { code, report } = await runSmoke(context, (pathname) => pathname === "/highscores"
      ? { status, body: { error: "resource_view_upgrade_required" } } : {});
    assert.equal(code, 1);
    assert.equal(report.ok, false);
    assert.ok(report.failures.includes("rankings request failed: resource_view_upgrade_required"));
    assert.ok(report.failures.includes("runtime-config noisy stress endpoints returned non-2xx, 429, or timed out"));
    assert.equal(report.evidence.find((entry) => entry.name === "rankings").status, status);
  });
}

test("nullable responses do not bypass readiness and wallet availability gates", async (context) => {
  const { code, report } = await runSmoke(context, (pathname) => {
    if (pathname === "/health") return { body: { ok: false, configured: false } };
    if (pathname === "/runtime-config") return { body: { featureSupport: { researchEndpoint: false, highscoresEndpoint: false } } };
    if (pathname.endsWith("/infrastructure")) return { body: { resources: null, infrastructureAvailable: false } };
    return {};
  }, ["--wallet", wallet]);
  assert.equal(code, 1);
  for (const failure of [
    "health.ok must be true", "health.configured must be true",
    "runtime featureSupport.researchEndpoint must be true",
    "runtime featureSupport.highscoresEndpoint must be true", "infrastructure unavailable"
  ]) assert.ok(report.failures.includes(failure), failure);
});

test("request and stress timeouts remain failures", async (context) => {
  const { code, report } = await runSmoke(context, (pathname) => pathname === "/highscores" ? { delay: 1000 } : {}, [
    "--timeout-ms", "100", "--runtime-stress-timeout-ms", "100"
  ]);
  assert.equal(code, 1);
  assert.ok(report.failures.includes("rankings timed out after 100ms"));
  assert.equal(report.evidence.find((entry) => entry.name === "rankings").timedOut, true);
  assert.ok(report.failures.includes("runtime-config noisy stress endpoints returned non-2xx, 429, or timed out"));
});

test("default runtime stress p95 gate remains 500ms", async (context) => {
  const { code, report } = await runSmoke(context, (pathname) => pathname === "/runtime-config" ? { delay: 550 } : {});
  assert.equal(code, 1);
  assert.ok(report.evidence.find((entry) => entry.name === "runtime-config-stress").p95Ms > 500);
  assert.ok(report.failures.some((failure) => /^runtime-config stress p95 \d+ms exceeded 500ms$/.test(failure)));
});
