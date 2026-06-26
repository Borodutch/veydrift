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

  test("resolves public docs and AI-reference routes", () => {
    expect(docsSlugFromPath("/docs")).toBe("beginner");
    expect(docsSlugFromPath("/docs/ai")).toBe("ai");
    expect(docsSlugFromPath("/docs/agents")).toBe("ai");
    expect(docsPageForSlug("ai").title).toBe("Veydrift AI Reference");

    const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(appSource).toContain('window.location.pathname.startsWith("/docs")');
    expect(appSource).toContain("return <DocsApp />");
  });

  test("renders route navigation, readable tables, anchors, and AI reference link", () => {
    const formulas = readDocsContent("formulas.md");
    const parsed = parseMarkdown(formulas);
    expect(parsed.headings.some((heading) => heading.id === "production")).toBe(true);
    expect(parsed.nodes.some((node) => node.type === "code" && node.value.includes("available cargo"))).toBe(true);

    const tree = DocsPage({ pathname: "/docs" });
    const links = elementNodes(tree).filter((node) => node.type === "a");

    expect(links.some((node) => node.props?.href === "/docs/ai")).toBe(true);
  });

  test("gameplay navigation exposes a discoverable Docs entry", () => {
    const source = readFileSync(new URL("../src/components/NavBar.tsx", import.meta.url), "utf8");

    expect(source).toContain('<NavLink href="/docs" icon={BookOpen} label="Docs" />');
    expect(source).toContain('<MobileLink href="/docs" icon={BookOpen} label="Docs" />');
  });

  test("docs content covers the required source files and excludes prohibited public references", () => {
    expect(docsPages.map((page) => page.slug)).toEqual(["beginner", "concepts", "catalogs", "formulas", "mechanics", "ai"]);
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
