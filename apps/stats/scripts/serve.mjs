import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const root = new URL("../dist/", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 3000);
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url);
    const requested = normalize(url.pathname).replace(/^(\.\.(\/|\\|$))+/, "");
    let path = join(root, requested);
    if (!existsSync(path) || statSync(path).isDirectory()) path = join(root, "index.html");
    return new Response(readFileSync(path), {
      headers: {
        "cache-control": path.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
        "content-type": mime[extname(path)] ?? "application/octet-stream",
        "x-content-type-options": "nosniff"
      }
    });
  }
});

console.log(`Veydrift stats listening on :${port}`);
