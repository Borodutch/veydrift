import { expect, test } from "bun:test";

test("manual nonce recovery cannot activate an uncapped broadcast even without config", async () => {
  const child = Bun.spawn([process.execPath, new URL("./resolverNonceRecovery.ts", import.meta.url).pathname,
    "--from", "7", "--through", "8", "--broadcast"], {
    env: { PATH: process.env.PATH ?? "" }, stdout: "pipe", stderr: "pipe"
  });
  const output = await new Response(child.stderr).text();
  expect(await child.exited).toBe(1);
  expect(output).toContain("resolver nonce recovery broadcast disabled");
  expect(await new Response(child.stdout).text()).toBe("");
});
