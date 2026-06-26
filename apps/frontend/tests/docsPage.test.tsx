import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { readFileSync, readdirSync, statSync } from "node:fs";
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
    expect(serveSource).toContain('return responseFor(Bun.file(staticFileUrl("/index.html")), "/index.html")');
    expect(serveSource).toContain('".md": "text/markdown; charset=utf-8"');

    const rawDocs = readFileSync(new URL("../public/docs.md", import.meta.url), "utf8");
    expect(rawDocs).toContain("# Veydrift Documentation");
    expect(rawDocs).toContain("GitHub: https://github.com/Borodutch/veydrift");
    expect(rawDocs).toContain("Combat example:");
    expect(rawDocs).not.toContain("Veydrift AI Reference");
  });

  test("renders route navigation, readable tables, anchors, and AI reference link", () => {
    const formulas = readDocsContent("formulas.md");
    const parsed = parseMarkdown(formulas);
    expect(parsed.headings.some((heading) => heading.id === "production")).toBe(true);
    expect(parsed.nodes.some((node) => node.type === "code" && node.value.includes("available cargo"))).toBe(true);

    const tree = DocsPage({ pathname: "/docs" });
    const links = elementNodes(tree).filter((node) => node.type === "a");

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
    for (const file of collectDocsFiles()) {
      const markdown = readFileSync(file, "utf8");
      expect(markdown.length).toBeGreaterThan(500);
      expect(/\bogame\b/i.test(markdown)).toBe(false);
      expect(/\bkaneo\b/i.test(markdown)).toBe(false);
      expect(/\bvey-kaneo-\d+\b/i.test(markdown)).toBe(false);
    }
  });
});

const DOCS_CONTENT_ROOT = new URL("../src/docs/content", import.meta.url).pathname;

function readDocsContent(file: string): string {
  return readFileSync(join(DOCS_CONTENT_ROOT, file), "utf8");
}

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
