import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { build, createServer, preview } from "vite";
import { frontendResponse } from "../scripts/serve.mjs";
import { SettlementSupportLinks } from "../src/FirstPlanetSettlementApp";
import { TopBar } from "../src/components/TopBar";

const root = fileURLToPath(new URL("../", import.meta.url));
const expectedHash = "8df4752e969a78aea041483daba10ee1a0a86873021d28d991a3ba3364e6ffaf";
const whitepaper = new URL("../public/whitepaper.pdf", import.meta.url);
// /whitepaper.pdf was the sole published document URL; also deny page-style
// paths, query strings, encoded names and Vite's public/source aliases.
const disabledPaths = [
  "/whitepaper.pdf", "/whitepaper.pdf?download=1", "/whitepaper.pdf/",
  "/%5Cwhitepaper.pdf", "/%5cWHITEPAPER.PDF", "/%5C%77hitepaper%2Epdf",
  "/whitepaper", "/whitepaper/", "/whitepaper/chapter",
  "/whitepaper.pdf%3Fdownload", "/whitepaper.pdf%23page=1",
  "/%77hitepaper%2Epdf", "/whitepaper%252Epdf", "/WHITEPAPER.PDF", "/public/whitepaper.pdf",
  `/@fs${fileURLToPath(whitepaper)}`,
  // Preserve the exact origin-form target, including duplicate/encoded leading
  // slashes on the document URL and Vite's public/source aliases.
  ...["/whitepaper.pdf", "/public/whitepaper.pdf", `/@fs${fileURLToPath(whitepaper)}`].flatMap((path) =>
    ["//", "/%2F", "/%252F", "/\\", "/%5C", "/%255C", "/%2F%5c", "/%255c%252F"].map((prefix) => `${prefix}${path.slice(1)}`)),
  ...["/public/", `/@fs${fileURLToPath(new URL("../public/", import.meta.url))}`].flatMap((prefix) =>
    ["/", "%2F", "%252F", "\\", "%5C", "%255c", "%2F%5C", "%255C%252f"].map((slash) => `${prefix}${slash}whitepaper.pdf`)),
  // Normalize backslashes within aliases and following the document name too.
  ...["%5C", "%255c"].flatMap((separator) => [
    `/public${separator}whitepaper.pdf`,
    `/@fs${fileURLToPath(whitepaper).replaceAll("/", separator)}`,
    `/whitepaper.pdf${separator}`,
    `/whitepaper${separator}chapter`,
  ]),
];

const normalAssetPath = "/assets/whitepaper-normal-control.js";
const normalFiles = new Map<URL, Buffer | undefined>();
let normalAsset = "";

beforeAll(async () => {
  // Emit a real frontend module without requiring a full app build before tests.
  const output = await build({
    root, configFile: false, publicDir: false, logLevel: "silent",
    build: {
      write: false, minify: false,
      lib: { entry: `${root}/src/requestDiagnostics.ts`, formats: ["es"], fileName: () => "control.js" },
    },
  });
  const bundle = Array.isArray(output) ? output[0] : output;
  if (!bundle || !("output" in bundle)) throw new Error("Expected JS build output");
  const chunk = bundle.output.find((item) => item.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("Missing emitted JS control");
  normalAsset = chunk.code;
  mkdirSync(new URL("../dist/assets/", import.meta.url), { recursive: true });
  for (const [path, contents] of [
    ["/robots.txt", readFileSync(new URL("../public/robots.txt", import.meta.url))],
    [normalAssetPath, Buffer.from(normalAsset)],
  ] as const) {
    const file = new URL(`../dist${path}`, import.meta.url);
    normalFiles.set(file, existsSync(file) ? readFileSync(file) : undefined);
    writeFileSync(file, contents);
  }
});

afterAll(() => {
  for (const [file, original] of normalFiles) {
    if (original === undefined) rmSync(file, { force: true });
    else writeFileSync(file, original);
  }
});

describe("hidden whitepaper", () => {
  test("retains the original repository PDF byte-for-byte", () => {
    expect(createHash("sha256").update(readFileSync(whitepaper)).digest("hex")).toBe(expectedHash);
  });

  test("has no entry point or searchable metadata in any frontend source", async () => {
    const sources = new Bun.Glob("src/**/*.{ts,tsx,css,md,json}");
    for await (const path of sources.scan({ cwd: root })) {
      if (/\.test\.tsx?$/.test(path)) continue;
      expect(await Bun.file(`${root}/${path}`).text()).not.toMatch(/white[ -]?paper/i);
    }
    for (const path of ["index.html", "miniAppMetadata.ts"]) {
      expect(await Bun.file(`${root}/${path}`).text()).not.toMatch(/white[ -]?paper/i);
    }
    const metadata = new Bun.Glob("public/**/*.{html,xml,txt,json,md}");
    for await (const path of metadata.scan({ cwd: root, dot: true })) {
      expect(await Bun.file(`${root}/${path}`).text()).not.toMatch(/white[ -]?paper/i);
    }
  });

  test("removes settlement and both desktop/mobile top bar links while retaining support", () => {
    for (const node of [SettlementSupportLinks(), renderTopBar()]) {
      const links = elementNodes(node).filter((item) => item.type === "a");
      expect(links.length).toBeGreaterThan(0);
      expect(JSON.stringify(links.map((link) => link.props))).not.toMatch(/whitepaper/i);
      expect(links.some((link) => link.props?.["aria-label"] === "Telegram support")).toBe(true);
    }
  });

  test("production returns normal 404s even with a stale PDF in dist", async () => {
    const stalePdf = new URL("../dist/whitepaper.pdf", import.meta.url);
    const existed = existsSync(stalePdf);
    mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });
    if (!existed) writeFileSync(stalePdf, readFileSync(whitepaper));
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: frontendResponse });
    try {
      await assertDisabled(server.url.toString());
      await assertNormalAssets(server.url.toString());
      const missing = await fetch(new URL("/missing-whitepaper-test", server.url));
      expect(missing.status).toBe(404);
      expect(await missing.text()).toBe("Not found");
    } finally {
      server.stop(true);
      if (!existed) rmSync(stalePdf);
    }
  });

  test("Vite development cannot serve the retained public PDF or page fallback", async () => {
    const server = await createServer({ root, server: { host: "127.0.0.1", port: 0 } });
    try {
      await server.listen();
      const address = server.httpServer!.address() as { port: number };
      await assertDisabled(`http://127.0.0.1:${address.port}/`);
      await assertNormalAssets(`http://127.0.0.1:${address.port}/`, true);
    } finally {
      await server.close();
    }
  }, 20_000);

  test("Vite preview denies stale static PDFs before serving files", async () => {
    const stalePdf = new URL("../dist/whitepaper.pdf", import.meta.url);
    const existed = existsSync(stalePdf);
    mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });
    if (!existed) writeFileSync(stalePdf, readFileSync(whitepaper));
    const server = await preview({ root, preview: { host: "127.0.0.1", port: 0 } });
    try {
      const address = server.httpServer.address() as { port: number };
      await assertDisabled(`http://127.0.0.1:${address.port}/`);
      await assertNormalAssets(`http://127.0.0.1:${address.port}/`);
    } finally {
      await new Promise<void>((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
      if (!existed) rmSync(stalePdf);
    }
  }, 20_000);
});

async function assertDisabled(origin: string) {
  for (const path of disabledPaths) {
    for (const method of ["GET", "HEAD"]) {
      // URL(path, origin) treats // as an authority; node:http's path option
      // sends the literal request target to the loopback server instead.
      const response = await literalRequest(origin, path, method);
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(response.body).toBe(method === "HEAD" ? "" : "Not found");
      expect(response.contentType).not.toContain("application/pdf");
    }
  }
}

async function assertNormalAssets(origin: string, development = false) {
  for (const method of ["GET", "HEAD"]) {
    const robots = await literalRequest(origin, "/robots.txt", method);
    expect(robots.status).toBe(200);
    expect(robots.body).toBe(method === "HEAD" ? "" : readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8"));
    // Vite dev serves the emitted module from the root-relative dist directory.
    const asset = await literalRequest(origin, `${development ? "/dist" : ""}${normalAssetPath}`, method);
    expect(asset.status).toBe(200);
    expect(asset.contentType).toMatch(/javascript/);
    if (method === "HEAD") expect(asset.body).toBe("");
    else if (development) expect(asset.body).toContain("diagnosticRoute");
    else expect(asset.body).toBe(normalAsset);
  }
}

function literalRequest(origin: string, path: string, method: string) {
  return new Promise<{ status: number | undefined; contentType: string; body: string }>((resolve, reject) => {
    const req = request(origin, { path, method, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("error", reject);
      res.on("end", () => resolve({
        status: res.statusCode,
        contentType: res.headers["content-type"] ?? "",
        body: Buffer.concat(chunks).toString(),
      }));
    });
    req.on("error", reject);
    req.setTimeout(5_000, () => req.destroy(new Error(`Timed out: ${method} ${path}`)));
    req.end();
  });
}

function renderTopBar(): ComponentChildren {
  return TopBar({
    caps: { metal: 10_000, crystal: 10_000, deuterium: 10_000 },
    isWalletConnected: true,
    rates: { metal: 77, crystal: 29, deuterium: 14 },
    resources: { metal: 56, crystal: 243, deuterium: 31 },
    resourceStatus: "ready",
  });
}

function elementNodes(node: ComponentChildren): VNode[] {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return [];
  if (Array.isArray(node)) return node.flatMap(elementNodes);
  const vnode = node as VNode;
  if (typeof vnode.type === "function") return [];
  return [vnode, ...elementNodes(vnode.props?.children as ComponentChildren)];
}
