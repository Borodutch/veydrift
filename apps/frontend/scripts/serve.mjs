const distRoot = new URL("../dist/", import.meta.url);
const port = Number(process.env.PORT || 80);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
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

function responseFor(file, pathname) {
  const headers = contentType(pathname)
    ? { "content-type": contentType(pathname) }
    : undefined;

  return new Response(file, { headers });
}

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
    const file = Bun.file(new URL(`.${route}`, distRoot));

    if (await file.exists()) {
      return responseFor(file, route);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Veydrift frontend listening on ${port}`);
