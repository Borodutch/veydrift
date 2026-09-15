import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { createServer, preview } from "vite";
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
  "/whitepaper", "/whitepaper/", "/whitepaper/chapter",
  "/whitepaper.pdf%3Fdownload", "/whitepaper.pdf%23page=1",
  "/%77hitepaper%2Epdf", "/whitepaper%252Epdf", "/WHITEPAPER.PDF", "/public/whitepaper.pdf",
  `/@fs${fileURLToPath(whitepaper)}`,
];

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
      expect((await fetch(`http://127.0.0.1:${address.port}/robots.txt`)).status).toBe(200);
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
    } finally {
      await new Promise<void>((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
      if (!existed) rmSync(stalePdf);
    }
  }, 20_000);
});

async function assertDisabled(origin: string) {
  for (const path of disabledPaths) {
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(new URL(path, origin), { method });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe(method === "HEAD" ? "" : "Not found");
      expect(response.headers.get("content-type") ?? "").not.toContain("application/pdf");
    }
  }
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
