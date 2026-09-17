import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";

import { safeDiagnosticText, sanitizeDiagnosticValue } from "./veydrift-safe-diagnostics.mjs";

const privateKey = `0x${"ab".repeat(32)}`;
const bearer = "synthetic-bearer-canary-1234567890";
const password = "synthetic-password-canary-1234567890";
const queryKey = "synthetic-query-canary-1234567890";
const opaque = "synthetic-opaque-canary-1234567890";
const canaries = [privateKey, bearer, password, queryKey, opaque];
const address = (digit) => `0x${digit.repeat(40)}`;
const publicTransactionHash = `0x${"cd".repeat(32)}`;

function assertNoCanaries(value) {
  const output = typeof value === "string" ? value : JSON.stringify(value);
  for (const canary of canaries) assert.equal(output.includes(canary), false);
}

test("sanitizes nested config, headers, private keys, URLs, and truncation", () => {
  const output = sanitizeDiagnosticValue({
    status: "running",
    Environment: { Signing_Private_Key: privateKey, AUTHORIZATION: `Bearer ${bearer}`, opaque },
    config: { value: opaque },
    releasePrivateKey: privateKey,
    deploymentSigningKey: password,
    providerApiKey: queryKey,
    clientSecretValue: opaque,
    requestHeaders: { customSigningMaterial: opaque },
    serviceConfig: { value: opaque },
    hash: privateKey,
    transactionHash: publicTransactionHash,
    endpoint: `https://user:${password}@rpc.invalid/path?apiKey=${queryKey}`
  });
  assertNoCanaries(output);
  assert.equal(output.status, "running");
  assert.equal(output.Environment, "[redacted]");
  assert.equal(output.config, "[redacted]");
  assert.equal(output.requestHeaders, "[redacted]");
  assert.equal(output.serviceConfig, "[redacted]");
  assert.equal(output.hash, "[redacted]");
  assert.equal(output.transactionHash, publicTransactionHash);
  assert.equal(output.endpoint, "https://rpc.invalid");

  const truncated = safeDiagnosticText(
    `Authorization: Bearer ${bearer} private_key=${privateKey} ${"x".repeat(5000)}`,
    120
  );
  assertNoCanaries(truncated);
  assert.match(truncated, /…\[truncated\]$/);
});

test("redacts scalar compound containers and custom error names while preserving configured flags", () => {
  const error = new Error("synthetic failure");
  error.name = opaque;
  const output = sanitizeDiagnosticValue({
    configured: true,
    gameConfigured: false,
    serviceConfig: opaque,
    requestHeaders: opaque,
    error
  });

  assertNoCanaries(output);
  assert.equal(output.configured, true);
  assert.equal(output.gameConfigured, false);
  assert.equal(output.serviceConfig, "[redacted]");
  assert.equal(output.requestHeaders, "[redacted]");
  assert.equal(output.error.name, "Error");
  assert.equal(output.error.message, "synthetic failure");
});

test("preflight emits allowlisted snapshots and no response bodies", async (context) => {
  const server = createServer(async (request, response) => {
    let body;
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/health") {
      body = {
        ok: true,
        configured: true,
        readiness: { ready: true, safeToServeIndexedState: true },
        backend: { worker: { role: "writer" }, build: { gitSha: "0123456789abcdef0123456789abcdef01234567" } },
        indexer: { indexedState: "healthy", safeToServeIndexedState: true, fromBlock: "1", latestIndexedBlock: "2" },
        environment: { SIGNING_PRIVATE_KEY: privateKey, opaque }
      };
    } else if (pathname === "/runtime-config") {
      body = {
        gameContractAddress: address("1"),
        contractAddress: address("1"),
        allianceContractAddress: address("2"),
        randomnessEngineAddress: address("3"),
        moonContractAddress: address("4"),
        resourceTokenAddresses: { metal: address("5"), crystal: address("6"), deuterium: address("7") },
        featureSupport: { researchEndpoint: true },
        config: { authorization: `Bearer ${bearer}`, opaque }
      };
    } else if (pathname === "/debug/indexer") {
      body = { indexedState: "healthy", safeToServeIndexedState: true, indexedPlanets: 0, environment: { secret: opaque } };
    } else {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      body = { jsonrpc: "2.0", id: payload.id, result: `0x${"0".repeat(64)}` };
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  const result = await run(process.execPath, [
    "scripts/veydrift-redeploy-preflight.mjs",
    "--api-url", origin,
    "--rpc-url", origin,
    "--migration-plan-approved"
  ]);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assertNoCanaries(result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.backendSnapshots.health.diagnostics["backend.worker.role"], "writer");
  assert.equal(report.backendSnapshots.health.diagnostics["backend.build.gitSha"], "0123456789abcdef0123456789abcdef01234567");
  assert.equal(report.backendSnapshots.runtime.diagnostics.gameContractAddress, address("1"));
  assert.equal(Object.hasOwn(report.backendSnapshots.health, "body"), false);
  assert.equal(JSON.stringify(report.backendSnapshots).includes("environment"), false);
  assert.equal(
    Object.values(report.backendSnapshots).some((snapshot) =>
      Object.keys(snapshot.diagnostics).some((key) => /(^|\.)config(?:\.|$)/i.test(key))
    ),
    false
  );

  const readiness = await run(process.execPath, [
    "scripts/veydrift-redeploy-readiness-probe.mjs",
    "--api-url", origin,
    "--duration-seconds", "1",
    "--interval-ms", "1000",
    "--timeout-ms", "500",
    "--endpoint", `/health?apiKey=${queryKey}`
  ]);
  assert.equal(readiness.code, 0, readiness.stderr || readiness.stdout);
  assertNoCanaries(readiness.stdout + readiness.stderr);
  assert.match(readiness.stdout, /\[redacted\]/);
});

test("referral migration fatal output sanitizes before stderr", async () => {
  const result = await run(process.execPath, [
    "scripts/veydrift-referral-migration-manifest.mjs",
    "--rpc-url", `https://user:${password}@rpc.invalid/path?apiKey=${queryKey}`,
    "--input", `/tmp/token=${bearer}-${privateKey}.json`,
    "--out", "/tmp/unused-referral-manifest.json"
  ]);
  assert.equal(result.code, 1);
  assertNoCanaries(result.stdout + result.stderr);
  assert.match(result.stderr, /ENOENT/);
});

test("preflight sanitizes credential-bearing positional arguments before usage stderr", async () => {
  const result = await run(process.execPath, [
    "scripts/veydrift-redeploy-preflight.mjs",
    `https://user:${password}@rpc.invalid/path?apiKey=${queryKey}`
  ]);
  assert.equal(result.code, 1);
  assertNoCanaries(result.stdout + result.stderr);
  assert.match(result.stderr, /Unexpected positional argument: https:\/\/rpc\.invalid/);
  assert.match(result.stderr, /Usage: node scripts\/veydrift-redeploy-preflight\.mjs/);
});

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
