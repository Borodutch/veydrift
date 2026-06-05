import { miniAppIconAliasTarget } from "../iconAliases.mjs";

const distRoot = new URL("../dist/", import.meta.url);
const port = Number(process.env.PORT || 80);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function contentType(pathname) {
  const match = pathname.match(/\.[^.]+$/);
  return match ? contentTypes[match[0]] : undefined;
}

export function cacheControl(pathname) {
  const assetPathname = miniAppIconAliasTarget(pathname) ?? pathname;

  if (assetPathname.startsWith("/assets/game/sizes/")) {
    return "public, max-age=604800";
  }

  if (assetPathname.startsWith("/assets/game/")) {
    return "public, max-age=604800";
  }

  if (assetPathname.startsWith("/assets/")) {
    return "public, max-age=31536000, immutable";
  }

  if (assetPathname === "/index.html") {
    return "no-cache";
  }

  return undefined;
}

export function responseHeadersFor(pathname) {
  const assetPathname = miniAppIconAliasTarget(pathname) ?? pathname;
  const headers = {};
  const type = contentType(assetPathname);
  const cache = cacheControl(pathname);

  if (type) headers["content-type"] = type;
  if (cache) headers["cache-control"] = cache;

  return headers;
}

function responseFor(file, pathname) {
  const headers = responseHeadersFor(pathname);

  return new Response(file, { headers });
}

if (import.meta.main) {
  Bun.serve({
    hostname: "0.0.0.0",
    port,
    async fetch(request) {
      const url = new URL(request.url);
      const pathname = decodeURIComponent(url.pathname);

      if (pathname.includes("..")) {
        return new Response("Bad request", { status: 400 });
      }

      const route = pathname === "/" ? "/index.html" : pathname;
      const assetRoute = miniAppIconAliasTarget(route) ?? route;
      const file = Bun.file(new URL(`.${assetRoute}`, distRoot));

      if (await file.exists()) {
        return responseFor(file, route);
      }

      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`Veydrift frontend listening on ${port}`);
}
