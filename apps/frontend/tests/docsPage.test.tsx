import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DocsPage } from "../src/components/DocsPage";
import { docsPageForSlug, docsPages, docsSlugFromPath } from "../src/docs/docsSource";
import { parseMarkdown } from "../src/docs/markdown";

describe("Markdown-backed docs", () => {
  test("parses headings, tables, lists, callouts, code blocks, links, and stable anchors", () => {
    const parsed = parseMarkdown(`# Title

> [!TIP]
> Read this first.

## Formula Block

\`\`\`text
energy scale = produced / required
\`\`\`

| Name | Value |
| --- | --- |
| Metal | [resource](/docs/concepts) |

1. Connect wallet
2. Settle planet
`);

    expect(parsed.headings.map((heading) => heading.id)).toEqual(["title", "formula-block"]);
    expect(parsed.nodes.some((node) => node.type === "callout" && node.tone === "tip")).toBe(true);
    expect(parsed.nodes.some((node) => node.type === "code" && node.value.includes("energy scale"))).toBe(true);
    expect(parsed.nodes.some((node) => node.type === "table" && node.headers.includes("Name"))).toBe(true);
    expect(parsed.nodes.some((node) => node.type === "list" && node.ordered)).toBe(true);
  });

  test("resolves public docs routes and raw Markdown reference", () => {
    expect(docsSlugFromPath("/docs")).toBe("beginner");
    expect(docsSlugFromPath("/docs/formulas")).toBe("formulas");
    expect(docsSlugFromPath("/docs/ai")).toBe("beginner");
    expect(docsPageForSlug("ai").title).toBe("Beginner Tutorial");

    const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(appSource).toContain('window.location.pathname.startsWith("/docs")');
    expect(appSource).toContain("return <DocsApp />");

    const serveSource = readFileSync(new URL("../scripts/serve.mjs", import.meta.url), "utf8");
    expect(serveSource).toContain('pathname === "/docs" || pathname.startsWith("/docs/")');
    expect(serveSource).toContain('pathname === "/play" || pathname.startsWith("/play/")');
    expect(serveSource).toContain('return responseFor(Bun.file(staticFileUrl("/index.html")), "/index.html")');
    expect(serveSource).toContain('".md": "text/markdown; charset=utf-8"');

    const rawDocs = readFileSync(new URL("../src/docs/content/docs.md", import.meta.url), "utf8");
    expect(rawDocs).toContain("# Veydrift Documentation");
    expect(rawDocs).toContain("GitHub: https://github.com/Borodutch/veydrift");
    expect(rawDocs).toContain("Combat example:");
    expect(rawDocs).toContain("### Rapidfire Reference");
    for (const row of [
      "| Cruiser | Light Fighter | 6 |",
      "| Destroyer | Small Cargo | 3 |",
      "| Destroyer | Large Cargo | 3 |",
      "| Destroyer | Battlecruiser | 2 |",
      "| Battlecruiser | Small Cargo | 3 |",
      "| Battlecruiser | Large Cargo | 4 |",
      "| Battlecruiser | Heavy Fighter | 4 |",
      "| Battlecruiser | Cruiser | 4 |",
      "| Battlecruiser | Battleship | 7 |",
      "| Reaper | Destroyer | 2 |",
      "| Reaper | Deathstar | 10 |",
      "| Pathfinder | Recycler | 3 |",
      "| Cruiser | Rocket Launcher | 10 |",
      "| Bomber | Rocket Launcher | 20 |",
      "| Bomber | Light Laser | 20 |",
      "| Bomber | Heavy Laser | 10 |",
      "| Bomber | Ion Cannon | 10 |",
      "| Destroyer | Light Laser | 10 |",
      "| Deathstar | Any defense | 200 |",
      "| Reaper | Plasma Turret | 2 |",
    ]) expect(rawDocs).toContain(row);
    expect(rawDocs).toContain("MAX_RAPIDFIRE_CHAIN = 64");
    expect(rawDocs).toContain("continueBps = floor((R - 1) * 10,000 / R)");
    expect(rawDocs).toContain('keccak256("veydrift.classic-combat-random-stream.v1")');
    expect(rawDocs).not.toContain("Veydrift AI Reference");
    expect(existsSync(new URL("../public/docs.md", import.meta.url))).toBe(false);

    const viteConfigSource = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    expect(viteConfigSource).toContain("src/docs/content/docs.md");
    expect(viteConfigSource).toContain('fileName: "docs.md"');

    const docsSource = readFileSync(new URL("../src/docs/docsSource.ts", import.meta.url), "utf8");
    expect(docsSource).toContain('import docsMarkdown from "./content/docs.md?raw"');
    expect(docsSource).not.toContain("beginner.md?raw");
    expect(docsSource).not.toContain("formulas.md?raw");
  });

  test("renders route navigation, readable tables, anchors, GitHub link, and AI reference link", () => {
    const rawDocs = readFileSync(new URL("../src/docs/content/docs.md", import.meta.url), "utf8");
    const formulas = markdownSectionForHeading(rawDocs, "Formulas");
    const parsed = parseMarkdown(formulas);
    expect(parsed.headings.some((heading) => heading.id === "production")).toBe(true);
    expect(parsed.nodes.some((node) => node.type === "code" && node.value.includes("available cargo"))).toBe(true);

    const tree = DocsPage({ pathname: "/docs" });
    const links = elementNodes(tree).filter((node) => node.type === "a");
    const githubLink = links.find((node) => node.props?.["aria-label"] === "Veydrift GitHub repository");

    expect(githubLink?.props?.href).toBe("https://github.com/Borodutch/veydrift");
    expect(githubLink?.props?.target).toBe("_blank");
    expect(githubLink?.props?.rel).toBe("noopener noreferrer");
    expect(links.some((node) => node.props?.href === "/docs.md")).toBe(true);
    expect(links.some((node) => node.props?.href === "/docs" && node.props?.children === "Docs")).toBe(false);
  });

  test("gameplay navigation exposes docs from the top bar, not the sidebar", () => {
    const navSource = readFileSync(new URL("../src/components/NavBar.tsx", import.meta.url), "utf8");
    const topBarSource = readFileSync(new URL("../src/components/TopBar.tsx", import.meta.url), "utf8");

    expect(navSource).not.toContain('href="/docs"');
    expect(topBarSource).toContain('aria-label="Veydrift documentation"');
    expect(topBarSource).toContain('href="/docs"');
  });

  test("docs content covers the required source files and excludes prohibited public references", () => {
    expect(docsPages.map((page) => page.slug)).toEqual(["beginner", "concepts", "catalogs", "formulas", "mechanics"]);
    const docsFiles = collectDocsFiles();
    expect(docsFiles.map((file) => file.split("/").at(-1))).toEqual(["docs.md"]);
    for (const file of docsFiles) {
      const markdown = readFileSync(file, "utf8");
      expect(markdown.length).toBeGreaterThan(500);
      expect(/\bogame\b/i.test(markdown)).toBe(false);
      expect(/\bkaneo\b/i.test(markdown)).toBe(false);
      expect(/\bvey-kaneo-\d+\b/i.test(markdown)).toBe(false);
    }
  });
});

const DOCS_CONTENT_ROOT = new URL("../src/docs/content", import.meta.url).pathname;

function collectDocsFiles(dir = DOCS_CONTENT_ROOT): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectDocsFiles(fullPath));
    } else if (entry.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function markdownSectionForHeading(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return markdown;

  const next = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  const end = next === -1 ? lines.length : next;
  return `${lines.slice(start, end).join("\n").trim()}\n`;
}

function elementNodes(node: ComponentChildren): VNode[] {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap(elementNodes);
  }

  const vnode = node as VNode;
  if (typeof vnode.type === "function") return [vnode];

  return [vnode, ...elementNodes(vnode.props?.children as ComponentChildren)];
}
