import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { injectShareMeta } from "../scripts/serve.mjs";

const tag = '<script defer src="https://lumen.borodutch.com/l.js"></script>';
const shell = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("Lumen analytics", () => {
  test("the HTML shell loads the Lumen script once, in the head", () => {
    const head = shell.slice(0, shell.indexOf("</head>"));
    expect(head.split(tag).length - 1).toBe(1);
    expect(shell.split("lumen.borodutch.com").length - 1).toBe(1);
  });

  test("share pages built from the shell keep the script", () => {
    const html = injectShareMeta(shell, {
      title: "Planet",
      description: "A planet",
      canonicalUrl: "https://veydrift.com/planet/1",
      imageUrl: "https://veydrift.com/og/planet/1.png",
    });
    expect(html).toContain(tag);
  });
});
