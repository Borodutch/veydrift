import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { frontendResponse, pactMeta } from "../scripts/serve.mjs";

const distIndex = new URL("../dist/index.html", import.meta.url);
const original = existsSync(distIndex) ? readFileSync(distIndex) : undefined;
if (!original) {
  mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });
  writeFileSync(distIndex, readFileSync(new URL("../index.html", import.meta.url)));
}
afterAll(() => { if (!original) rmSync(distIndex, { force: true }); });

test("/pact serves its own share title, description and image", async () => {
  const html = await (await frontendResponse(new Request("https://veydrift.com/pact"))).text();
  expect(html).toContain(`<meta property="og:image" content="https://veydrift.com${pactMeta.imagePath}" />`);
  expect(html).toContain(`<meta name="twitter:image" content="https://veydrift.com${pactMeta.imagePath}" />`);
  expect(html).toContain(`<link rel="canonical" href="https://veydrift.com/pact" />`);
  expect(html).toContain("<title>The Veydrift Pact");
  expect(existsSync(new URL(`../public${pactMeta.imagePath}`, import.meta.url))).toBe(true);
});
