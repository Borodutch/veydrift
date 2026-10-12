import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./host-build-io/build-io-throttle", import.meta.url));
const unlimited = "9:2 rbps=max wbps=max riops=max wiops=max\n";
const easypanelId = "0f96aa";

function fixture(runSteps, { easypanel = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "build-io-throttle-"));
  const slice = join(root, "system.slice");
  const cgroup = (name) => {
    mkdirSync(join(slice, name), { recursive: true });
    writeFileSync(join(slice, name, "io.max"), unlimited);
    return join(slice, name, "io.max");
  };
  const runs = runSteps.map((id) => cgroup(`system.slice:docker:${id}`));
  const service = cgroup("docker-backend.scope");
  const ep = easypanel ? cgroup(`docker-${easypanelId}.scope`) : undefined;
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "docker"), `#!/bin/sh\n${easypanel ? `echo ${easypanelId}` : "true"}\n`);
  chmodSync(join(bin, "docker"), 0o755);
  const run = () => spawnSync("bash", [script], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CGROUP_SLICE: slice, ONCE: "1" },
  });
  return { root, runs, service, ep, run };
}

const wbps = (file) => /wbps=(\S+)/.exec(readFileSync(file, "utf8"))[1];

test("RUN steps share the budget and the EasyPanel container is capped", () => {
  const f = fixture(["a", "b"]);
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.runs.map(wbps), ["5242880", "5242880"]);
    assert.equal(wbps(f.ep), "10485760");
    assert.equal(wbps(f.service), "max", "running service containers are never capped");
    assert.equal(result.stdout.trim().split("\n").length, 3);
    // Already-capped cgroups are left alone.
    assert.equal(f.run().stdout, "");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("per-step cap never drops below the floor", () => {
  const f = fixture(Array.from({ length: 8 }, (_, i) => `s${i}`), { easypanel: false });
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.ok(f.runs.every((file) => wbps(file) === "2097152"));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("no builds and no EasyPanel container is a no-op", () => {
  const f = fixture([], { easypanel: false });
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(wbps(f.service), "max");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
