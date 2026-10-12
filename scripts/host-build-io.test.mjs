import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./host-build-io/build-io-throttle", import.meta.url));
const easypanelId = "0f96aa";

function fixture(runSteps, { easypanel = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "build-io-throttle-"));
  const slice = join(root, "system.slice");
  // The kernel's io.max is empty until a limit is set.
  const cgroup = (name) => {
    mkdirSync(join(slice, name), { recursive: true });
    writeFileSync(join(slice, name, "io.max"), "");
    return join(slice, name, "io.max");
  };
  const runs = runSteps.map((id) => cgroup(`system.slice:docker:${id}`));
  const service = cgroup("docker-backend.scope");
  const ep = easypanel ? cgroup(`docker-${easypanelId}.scope`) : undefined;
  const bin = join(root, "bin");
  mkdirSync(bin);
  const stub = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub("docker", easypanel ? `echo ${easypanelId}` : "true");
  stub("timeout", 'shift; exec "$@"');
  // util-linux pads the column, as on the host.
  stub("findmnt", "echo '  9:2'");
  const run = () => spawnSync("bash", [script], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CGROUP_SLICE: slice, DEV: "", ONCE: "1" },
  });
  return { root, runs, service, ep, run };
}

const wbps = (file) => /^9:2 .*?wbps=(\S+)/m.exec(readFileSync(file, "utf8"))?.[1] ?? "max";

test("each RUN step and the EasyPanel container are capped", () => {
  const f = fixture(["a", "b"]);
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.runs.map(wbps), ["16777216", "16777216"]);
    assert.equal(wbps(f.ep), "10485760");
    assert.equal(wbps(f.service), "max", "running service containers are never capped");
    assert.equal(result.stdout.trim().split("\n").length, 3);
    // Already-capped cgroups are left alone.
    assert.equal(f.run().stdout, "");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("a rejected cap is reported, not silently skipped", () => {
  const f = fixture(["a"], { easypanel: false });
  try {
    chmodSync(f.runs[0], 0o444);
    const first = f.run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stderr, /failed to cap system\.slice:docker:a/);
    assert.equal(wbps(f.runs[0]), "max");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("no builds and no EasyPanel container is a no-op", () => {
  const f = fixture([], { easypanel: false });
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout + result.stderr, "");
    assert.equal(wbps(f.service), "max");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
