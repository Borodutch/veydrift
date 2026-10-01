import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {parseShard} from "./run-tests-separately.mjs";

// Run once in the normal contract gate, not independently on every CI shard.
const shard = parseShard(process.env.CONTRACT_TEST_SHARD);
if (!shard || shard.index === 1) {
  const contracts = fileURLToPath(new URL("../", import.meta.url));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const env = {...process.env, VEY918_EXPORT_FIXTURE: "true"};
  for (const key of ["NO_PROXY", "no_proxy"]) {
    env[key] = [env[key], "127.0.0.1", "localhost"].filter(Boolean).join(",");
  }
  for (const [command, args, cwd] of [
    ["forge", ["test", "--match-test", "testExportMixedProxyFixture", "-vv"], contracts],
    ["bun", ["scripts/mission-batch-mixed-proxy-proof.ts"], root]
  ]) {
    const result = spawnSync(command, args, {cwd, env, stdio: "inherit", timeout: 180_000});
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
