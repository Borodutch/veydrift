import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Bun.serve defaults `development` to NODE_ENV !== "production", and the Easypanel images run with
// NODE_ENV unset (#104). Every server that ships must therefore pass `development: false` itself, or
// an uncaught handler error returns Bun's dev error page with the message and source paths.
const root = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = /\.(ts|tsx|mjs|js)$/;
const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", "out", "cache", "lib", ".media", "tests"]);
// Local tooling that never runs in a deployed service.
const TOOLING = new Set(["apps/frontend/scripts/benchmark-animation-delivery.mjs"]);

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(path);
    return SOURCE.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

// The argument text of each Bun.serve(...) call, up to its matching parenthesis.
function serveCalls(source) {
  const calls = [];
  for (const match of source.matchAll(/\bBun\.serve\(/g)) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (depth > 0 && end < source.length) {
      if (source[end] === "(") depth += 1;
      else if (source[end] === ")") depth -= 1;
      end += 1;
    }
    const line = source.slice(0, match.index).split("\n").length;
    calls.push({ line, args: source.slice(match.index + match[0].length, end - 1) });
  }
  return calls;
}

test("every deployed Bun.serve call disables development mode explicitly", () => {
  const calls = ["apps", "packages"]
    .flatMap((dir) => sourceFiles(join(root, dir)))
    .map((file) => relative(root, file))
    .filter((file) => !TOOLING.has(file))
    .flatMap((file) => serveCalls(readFileSync(join(root, file), "utf8")).map((call) => ({ file, ...call })));

  assert.ok(calls.length >= 9, `expected the known production servers, found ${calls.length}`);
  const missing = calls
    .filter(({ args }) => !/\bdevelopment:\s*false\b/.test(args))
    .map(({ file, line }) => `${file}:${line}`);
  assert.deepEqual(missing, [], "add `development: false` to these Bun.serve calls");
});

test("development: false hides handler errors even when NODE_ENV is unset", (t) => {
  const probe = `
    const server = Bun.serve({ development: false, port: 0, fetch() { throw new Error("secret-handler-detail"); } });
    const response = await fetch(server.url);
    console.log(JSON.stringify({ status: response.status, body: await response.text() }));
    server.stop(true);
  `;
  const env = { ...process.env };
  delete env.NODE_ENV;
  const run = spawnSync("bun", ["-e", probe], { encoding: "utf8", env, timeout: 30_000 });
  if (run.error?.code === "ENOENT") return t.skip("bun is not installed");
  // Bun still logs the handler error and exits non-zero afterwards; only the response matters here.
  const result = run.stdout.trim().split("\n").at(-1);
  assert.ok(result, run.stderr);
  const { status, body } = JSON.parse(result);
  assert.equal(status, 500);
  assert.doesNotMatch(body, /secret-handler-detail/);
});
