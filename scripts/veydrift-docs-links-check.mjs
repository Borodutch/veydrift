import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Repository convention check, not a full CommonMark parser. Supports inline/reference links,
// ATX/setext heading anchors and explicit HTML anchors; never fetches remote URLs.
export function markdownReferences(source) {
  const text = source.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^ {0,3}(\x60{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gm, "");
  const anchors = new Set();
  const headings = /^(?: {0,3}#{1,6}[ \t]+(.+?)\s*#*\s*$|(.+)\n {0,3}(?:=+|-+)[ \t]*$)/gm;
  for (const match of text.matchAll(headings)) {
    const slug = (match[1] ?? match[2]).trim().toLowerCase()
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "")
      .replace(/\s/g, "-");
    let anchor = slug;
    let suffix = 0;
    while (anchors.has(anchor)) anchor = slug + "-" + ++suffix;
    anchors.add(anchor);
  }
  for (const match of text.matchAll(/<(?:a|h[1-6])\b[^>]*\b(?:id|name)=["']([^"']+)["']/gi)) {
    anchors.add(match[1]);
  }
  const links = [];
  const prose = text.replace(/\x60+([^\x60\n]*)\x60+/g, "");
  for (const match of prose.matchAll(/\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^"\n]*["'])?\s*\)|^ {0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/gm)) {
    links.push(match[1] ?? match[2] ?? match[3] ?? match[4]);
  }
  return { anchors, links };
}

export function checkMarkdownLinks(files, root) {
  const parsed = new Map();
  const read = (path) => {
    if (!parsed.has(path)) parsed.set(path, markdownReferences(readFileSync(path, "utf8")));
    return parsed.get(path);
  };
  const errors = [];
  for (const file of files) {
    const path = resolve(root, file);
    for (const link of read(path).links) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link)) continue;
      try {
        const [destination, fragment] = link.split("#", 2);
        const pathname = decodeURIComponent(destination.split("?", 1)[0]);
        const target = pathname ? resolve(pathname.startsWith("/") ? root : dirname(path), pathname.replace(/^\/+/, "")) : path;
        if (!existsSync(target)) errors.push(file + ": missing target " + link);
        else if (fragment && extname(target).toLowerCase() === ".md"
          && !read(target).anchors.has(decodeURIComponent(fragment))) {
          errors.push(file + ": missing anchor " + link);
        }
      } catch (error) {
        errors.push(file + ": invalid link " + link + " (" + error.message + ")");
      }
    }
  }
  return errors;
}

export function checkRepositoryMarkdownLinks() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const files = [...new Set(execFileSync("git", [
    "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.md",
    ":(exclude)packages/contracts/lib/**"
  ], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0").filter(Boolean))]
    .filter((file) => existsSync(resolve(root, file)));
  const errors = checkMarkdownLinks(files, root);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Repository Markdown links passed (" + files.length + " files).");
}
