import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkMarkdownLinks, markdownReferences } from "./veydrift-docs-links-check.mjs";

test("repository Markdown links: paths, anchors, references and examples", () => {
  const root = mkdtempSync(join(tmpdir(), "veydrift-doc-links-"));
  try {
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "Other Guide.md"),
      "# Hello, World!\n## Hello, World!\n## Café\nSetext title\n---\n<a id=\"custom\"></a>\n");
    writeFileSync(join(root, "README.md"), [
      "# Start", "[one](docs/Other%20Guide.md#hello-world)",
      "[two](<docs/Other Guide.md#hello-world-1>)",
      "[root](/docs/Other%20Guide.md#caf%C3%A9)", "[self](#start)",
      "[ref]: docs/Other%20Guide.md#setext-title",
      "[custom](docs/Other%20Guide.md#custom \"title\")",
      "[external](https://example.com/missing)", "[email](mailto:a@example.com)",
      "~~~md", "[example](missing.md)", "~~~",
      "<!-- [old](removed.md) -->",
      "\x60[example](not-a-link.md)\x60",
      "[\x60code label\x60](docs/Other%20Guide.md)",
      "\x60\x60\x60sh", "[example](not-a-command.md)", "\x60\x60\x60"
    ].join("\n"));
    assert.deepEqual(checkMarkdownLinks(["README.md", "docs/Other Guide.md"], root), []);
    writeFileSync(join(root, "bad.md"),
      "[gone](missing.md)\n[anchor](README.md#absent)\n[bad](bad%zz.md)\n[ref]: missing-ref.md");
    const errors = checkMarkdownLinks(["bad.md"], root);
    assert.equal(errors.length, 4);
    assert.match(errors[0], /missing target/);
    assert.match(errors[1], /missing anchor/);
    assert.match(errors[2], /invalid link/);
    assert.match(errors[3], /missing target/);
    assert.deepEqual([...markdownReferences("# A\n# A\n# A-1").anchors], ["a", "a-1", "a-1-1"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
