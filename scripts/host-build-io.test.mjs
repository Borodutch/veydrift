import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./host-build-io/build-io-throttle", import.meta.url));
const easypanelId = "0f96aa";
const MiB = 1048576;

// growth: cgroup name -> bytes it writes per tick (default 0).
function fixture(runSteps, { easypanel = true, daemons = true, growth = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "build-io-throttle-"));
  const slice = join(root, "system.slice");
  // The kernel's io.max is empty until a limit is set.
  const cgroup = (name) => {
    mkdirSync(join(slice, name), { recursive: true });
    writeFileSync(join(slice, name, "io.max"), "");
    return join(slice, name, "io.max");
  };
  const daemonFiles = daemons ? ["docker.service", "containerd.service"].map(cgroup) : [];
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
  // io.stat for `grep -H "^9:2 " <dir>/io.stat...`: each cgroup's wbytes grows by
  // its growth per call, i.e. per budget split.
  const calls = join(root, "grep-calls");
  writeFileSync(calls, "0");
  const rates = Object.entries(growth).map(([name, bytes]) => `*/${name}/io.stat) w=$((n * ${bytes})) ;;`).join("\n    ");
  stub("grep", `n=$(cat '${calls}'); n=$((n + 1)); echo $n > '${calls}'
shift 2
for f; do
  case "$f" in
    ${rates}
    *) w=0 ;;
  esac
  echo "$f:9:2 rbytes=0 wbytes=$w rios=0 wios=0 dbytes=0 dios=0"
done`);
  const run = (env = {}) => spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, CGROUP_SLICE: slice, DEV: "",
      TICKS: "1", INTERVAL: "0", ...env,
    },
  });
  return { root, daemons: daemonFiles, runs, service, ep, run };
}

const wbps = (file) => /^9:2 .*?wbps=(\S+)/m.exec(readFileSync(file, "utf8"))?.[1] ?? "max";
const BUDGET = 12 * MiB;
const share = (writers) => String(Math.floor(BUDGET / writers / 65536) * 65536);

test("all build writers share one budget", () => {
  const f = fixture(["a", "b"]);
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    // New writers count as active: 2 daemons + EasyPanel + 2 RUN steps.
    const writers = [...f.daemons, f.ep, ...f.runs];
    assert.deepEqual(writers.map(wbps), Array(5).fill(share(5)));
    assert.equal(wbps(f.service), "max", "running service containers are never capped");
    assert.equal(result.stdout.trim().split("\n").length, 5);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("idle writers give their share to the active ones", () => {
  // The RUN step writes 1 MiB per window; dockerd, containerd and EasyPanel are idle.
  const f = fixture(["a"], { growth: { "system.slice:docker:a": MiB } });
  try {
    const result = f.run({ TICKS: "4", WINDOW: "1", HOLD: "2" });
    assert.equal(result.status, 0, result.stderr);
    const writers = [...f.daemons, f.ep, ...f.runs];
    assert.deepEqual(writers.map(wbps), Array(4).fill(String(BUDGET)));
    // Split 4 ways while all are new, still 4 ways while the idle ones are held
    // active, then the whole budget once they drop out: two caps per writer.
    const lines = result.stdout.trim().split("\n");
    assert.equal(lines.filter((l) => l.endsWith(`wbps=${share(4)}`)).length, 4);
    assert.equal(lines.filter((l) => l.endsWith(`wbps=${BUDGET}`)).length, 4);
    assert.equal(lines.length, 8, "unchanged caps are not rewritten");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("parallel build steps split the budget and never go below the floor", () => {
  const growth = Object.fromEntries(["a", "b", "c"].map((id) => [`system.slice:docker:${id}`, MiB]));
  const f = fixture(["a", "b", "c"], { growth });
  try {
    let result = f.run({ TICKS: "3", WINDOW: "1", HOLD: "1" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.runs.map(wbps), Array(3).fill(share(3)));
    assert.deepEqual([...f.daemons, f.ep].map(wbps), Array(3).fill(share(3)), "idle writers get the same share");
    result = f.run({ BUDGET: String(2 * MiB), FLOOR: String(MiB) });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.runs.map(wbps), Array(3).fill(String(MiB)));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("a rejected cap is reported, not silently skipped", () => {
  const f = fixture(["a"], { easypanel: false, daemons: false });
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

test("no build writers is a no-op", () => {
  const f = fixture([], { easypanel: false, daemons: false });
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout + result.stderr, "");
    assert.equal(wbps(f.service), "max");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
