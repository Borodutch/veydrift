import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./host-build-io/build-io-throttle", import.meta.url));
const easypanelId = "0f96aa";
const MiB = 1048576;
const BUDGET = 16 * MiB;
const q = (bytes) => String(Math.floor(bytes / 524288) * 524288);

// growth: cgroup name (relative to the slice; "" is the slice itself) -> bytes
// written per budget split. onSplit: shell run on the first split.
function fixture(runSteps, { easypanel = true, daemons = true, growth = {}, onSplit = "" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "build-io-throttle-"));
  const slice = join(root, "system.slice");
  // The kernel's io.max is empty until a limit is set.
  const cgroup = (name) => {
    mkdirSync(join(slice, name), { recursive: true });
    writeFileSync(join(slice, name, "io.max"), "");
    writeFileSync(join(slice, name, "io.stat"), "");
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
  // Stands in for `grep -H "^9:2 " <slice>/io.stat <slice>/*/io.stat`: every
  // cgroup's wbytes grows by its growth per call, i.e. per budget split.
  const calls = join(root, "grep-calls");
  writeFileSync(calls, "0");
  const rates = Object.entries(growth)
    .map(([name, bytes]) => `'${name ? join(slice, name) : slice}/io.stat') w=$((n * ${bytes})) ;;`)
    .join("\n    ");
  stub("grep", `[ "$1 $2" = "-H ^9:2 " ] || { echo "unexpected grep $*" >&2; exit 2; }
n=$(cat '${calls}'); n=$((n + 1)); echo $n > '${calls}'
[ $n -eq 1 ] && { ${onSplit || ":"}; }
shift 2
for f; do
  [ -e "$f" ] || [ "$f" = '${slice}/io.stat' ] || continue
  case "$f" in
    ${rates}
    *) w=0 ;;
  esac
  echo "$f:9:2 rbytes=0 wbytes=$w rios=0 wios=0 dbytes=0 dios=0"
done`);
  const run = (env = {}, args = []) => spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, CGROUP_SLICE: slice, DEV: "",
      TICKS: "1", INTERVAL: "0", WINDOW: "1", ...env,
    },
  });
  return { root, slice, daemons: daemonFiles, runs, service, ep, run };
}

const wbps = (file) => /^9:2 .*?wbps=(\S+)/m.exec(readFileSync(file, "utf8"))?.[1] ?? "max";

function withFixture(f, body) {
  try {
    body(f);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}

test("the daemons and the other build writers each split the budget", () => withFixture(fixture(["a", "b"]), (f) => {
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  // New writers count as active: 2 daemons; EasyPanel and 2 RUN steps.
  assert.deepEqual(f.daemons.map(wbps), [q(BUDGET / 2), q(BUDGET / 2)]);
  assert.deepEqual([f.ep, ...f.runs].map(wbps), Array(3).fill(q(BUDGET / 3)));
  assert.equal(wbps(f.service), "max", "running service containers are never capped");
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.filter((l) => l.startsWith("capped ")).length, 5);
  assert.deepEqual(lines.filter((l) => l.startsWith("share ")), [
    `share wbps=${q(BUDGET / 3)} daemons wbps=${q(BUDGET / 2)} active=2+3 daemons=0 gone=0`,
  ]);
}));

test("idle writers give their share to the active ones", () => {
  // The RUN step writes 1 MiB per window; dockerd, containerd and EasyPanel are idle.
  const growth = { "": MiB, "system.slice:docker:a": MiB };
  withFixture(fixture(["a"], { growth }), (f) => {
    const result = f.run({ TICKS: "4", HOLD: "2" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual([...f.daemons, f.ep, ...f.runs].map(wbps), Array(4).fill(String(BUDGET)));
    // Split while all are new, unchanged while the idle ones are held active,
    // then the whole budget once they drop out. Re-caps are not logged.
    const lines = result.stdout.trim().split("\n");
    assert.equal(lines.filter((l) => l.startsWith("capped ")).length, 4);
    assert.deepEqual(lines.filter((l) => l.startsWith("share ")).map((l) => l.split(" ").slice(1, 4).join(" ")), [
      `wbps=${q(BUDGET / 2)} daemons wbps=${q(BUDGET / 2)}`,
      `wbps=${BUDGET} daemons wbps=${BUDGET}`,
    ]);
  });
});

test("daemon writes and drain of removed cgroups come off the other writers' budget", () => {
  // containerd exports at 6 MiB/s, the RUN step writes 6 MB/s, and a finished
  // step (already removed) still drains 3 MiB/s. Between the two splits the
  // counters gain a digit (6291456 -> 12582912, 6000000 -> 12000000), which
  // must not be compared as text.
  const growth = { "": 9 * MiB + 6000000, "containerd.service": 6 * MiB, "system.slice:docker:a": 6000000 };
  withFixture(fixture(["a"], { growth }), (f) => {
    const result = f.run({ TICKS: "2", HOLD: "1" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.daemons.map(wbps), [String(BUDGET), String(BUDGET)], "one busy daemon gets the whole budget");
    assert.deepEqual([f.ep, ...f.runs].map(wbps), [q(7 * MiB), q(7 * MiB)], "idle EasyPanel gets the same share");
    assert.match(result.stdout, new RegExp(`active=1\\+1 daemons=${6 * MiB} gone=${3 * MiB}`));
  });
});

test("rates are taken over the time since the last split", () => {
  // A new step forces a split one 0.25 s tick after the regular one: the 1 MiB
  // containerd wrote meanwhile is 4 MiB/s, not 1 MiB per 1 s window.
  const added = "system.slice:docker:new";
  const onSplit = `mkdir "$CGROUP_SLICE/${added}"; : > "$CGROUP_SLICE/${added}/io.max"`;
  const growth = { "": MiB, "containerd.service": MiB };
  withFixture(fixture(["a"], { easypanel: false, growth, onSplit }), (f) => {
    const result = f.run({ TICKS: "2", WINDOW: "4", INTERVAL: "0.25" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`daemons=${4 * MiB} gone=0`));
    assert.equal(wbps(join(f.slice, added, "io.max")), q(6 * MiB), "(16 - 4) MiB/s split between a and new");
  });
});

test("busy daemons leave the other writers no less than the floor", () => {
  const growth = { "": 18 * MiB, "containerd.service": 15 * MiB };
  for (const id of ["a", "b", "c"]) growth[`system.slice:docker:${id}`] = MiB;
  withFixture(fixture(["a", "b", "c"], { growth }), (f) => {
    const result = f.run({ TICKS: "2", HOLD: "1" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.runs.map(wbps), Array(3).fill(String(MiB)));
  });
});

test("steps started between splits are split in at once and a finished one is forgotten", () => {
  const added = ["system.slice:docker:new1", "system.slice:docker:new2"];
  const onSplit = [`rm -r "$CGROUP_SLICE/system.slice:docker:b"`,
    ...added.map((id) => `mkdir "$CGROUP_SLICE/${id}"; : > "$CGROUP_SLICE/${id}/io.max"`)].join("; ");
  withFixture(fixture(["a", "b"], { easypanel: false, daemons: false, onSplit }), (f) => {
    // The first split sees a and b (6 MiB/s each); the next tick, between
    // splits, sees a, new1 and new2, and re-splits at once instead of giving
    // the new steps the current share.
    const result = f.run({ TICKS: "2", WINDOW: "4", BUDGET: String(12 * MiB) });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual([f.runs[0], ...added.map((id) => join(f.slice, id, "io.max"))].map(wbps), Array(3).fill(q(4 * MiB)));
    assert.equal(existsSync(join(f.slice, "system.slice:docker:b")), false);
  });
});

test("release puts the daemons and EasyPanel back to the budget", () => withFixture(fixture(["a"]), (f) => {
  for (const file of [...f.daemons, f.ep, ...f.runs]) writeFileSync(file, "9:2 rbps=max wbps=1048576 riops=max wiops=max\n");
  const result = f.run({}, ["release"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual([...f.daemons, f.ep].map((file) => readFileSync(file, "utf8").trim()), Array(3).fill(`9:2 wbps=${BUDGET}`));
  assert.equal(wbps(f.runs[0]), "1048576", "running steps keep their caps");
}));

test("a rejected cap is reported, not silently skipped", () => withFixture(fixture(["a"], { easypanel: false, daemons: false }), (f) => {
  chmodSync(f.runs[0], 0o444);
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stderr, /failed to cap system\.slice:docker:a/);
  assert.equal(wbps(f.runs[0]), "max");
}));

test("no build writers is a no-op", () => withFixture(fixture([], { easypanel: false, daemons: false }), (f) => {
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout + result.stderr, "");
  assert.equal(wbps(f.service), "max");
}));
