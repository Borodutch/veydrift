import { expect, test } from "bun:test";
import { assertStandaloneKeeperReleaseAllowed } from "./releaseGuard";

test("standalone keeper has no runtime enable switch before config, signer, journal or transport", async () => {
  expect(assertStandaloneKeeperReleaseAllowed).toThrow("Standalone battle-keeper disabled");
  const child = Bun.spawn([process.execPath, new URL("./index.ts", import.meta.url).pathname], {
    env: { PATH: process.env.PATH ?? "", VEYDRIFT_MISSION_BATCH_ENABLED: "true" }, stdout: "pipe", stderr: "pipe"
  });
  const output = await new Response(child.stderr).text();
  expect(await child.exited).not.toBe(0);
  expect(output).toContain("Standalone battle-keeper disabled");
  expect(await new Response(child.stdout).text()).not.toContain("[battle-keeper] starting");
});
