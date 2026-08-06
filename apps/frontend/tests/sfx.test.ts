import { describe, expect, test } from "bun:test";

describe("sound effects", () => {
  test("keeps browser audio startup failures from aborting the requesting UI action", async () => {
    const moduleUrl = new URL("../src/sfx.ts", import.meta.url).href;
    const script = `
      globalThis.window = {
        localStorage: { getItem() { return null; } },
        AudioContext: class {
          constructor() { throw new Error("simulated AudioContext startup failure"); }
        },
      };
      const { playSfx } = await import(${JSON.stringify(moduleUrl)});
      playSfx("tab");
    `;
    const child = Bun.spawn([process.execPath, "-e", script], {
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
