import { expect, test } from "bun:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { compressHtml } from "../scripts/serve.mjs";

const html = `<!doctype html><title>Veydrift</title>${"<p>Settle planets, build fleets.</p>".repeat(500)}`;
const page = () => new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
const request = (encoding?: string) => new Request("https://veydrift.com/", { headers: encoding ? { "accept-encoding": encoding } : {} });

test("pages go out compressed, brotli first, with their other headers kept", async () => {
  const br = await compressHtml(request("gzip, deflate, br"), page());
  expect(br.headers.get("content-encoding")).toBe("br");
  expect(br.headers.get("vary")).toBe("accept-encoding");
  expect(br.headers.get("cache-control")).toBe("no-cache");
  expect(brotliDecompressSync(new Uint8Array(await br.arrayBuffer())).toString()).toBe(html);

  const gzip = await compressHtml(request("gzip"), page());
  expect(gzip.headers.get("content-encoding")).toBe("gzip");
  expect(gunzipSync(new Uint8Array(await gzip.arrayBuffer())).toString()).toBe(html);
});

test("clients without compression and responses other than pages pass through untouched", async () => {
  const plain = page();
  expect(await compressHtml(request(), plain)).toBe(plain);
  const image = new Response("webp", { headers: { "content-type": "image/webp" } });
  expect(await compressHtml(request("br"), image)).toBe(image);
});
