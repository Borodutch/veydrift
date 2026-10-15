import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { frontendResponse, ccaMeta } from "../scripts/serve.mjs";

const distIndex = new URL("../dist/index.html", import.meta.url);
const original = existsSync(distIndex) ? readFileSync(distIndex) : undefined;
if (!original) {
  mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });
  writeFileSync(distIndex, readFileSync(new URL("../index.html", import.meta.url)));
}
afterAll(() => { if (!original) rmSync(distIndex, { force: true }); });

test("/cca serves its own share title, description and image", async () => {
  const html = await (await frontendResponse(new Request("https://veydrift.com/cca"))).text();
  expect(html).toContain(`<meta property="og:image" content="https://veydrift.com${ccaMeta.imagePath}" />`);
  expect(html).toContain(`<meta name="twitter:image" content="https://veydrift.com${ccaMeta.imagePath}" />`);
  expect(html).toContain(`<link rel="canonical" href="https://veydrift.com/cca" />`);
  expect(html).toContain("<title>$VEYDRIFT continuous clearing auction");
  expect(existsSync(new URL(`../public${ccaMeta.imagePath}`, import.meta.url))).toBe(true);
});

test("/pact is gone", async () => {
  const html = await (await frontendResponse(new Request("https://veydrift.com/pact"))).text();
  expect(html).not.toContain("veydrift.com/pact");
  expect(html).not.toContain(ccaMeta.title);
});
