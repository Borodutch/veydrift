export type MarkdownNode =
  | { type: "heading"; depth: number; text: string; id: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "code"; language: string; value: string }
  | { type: "callout"; tone: "note" | "tip" | "warning"; text: string };

export type ParsedMarkdown = {
  headings: Array<{ depth: number; id: string; text: string }>;
  nodes: MarkdownNode[];
};

export function parseMarkdown(markdown: string): ParsedMarkdown {
  const nodes: MarkdownNode[] = [];
  const headings: ParsedMarkdown["headings"] = [];
  const usedSlugs = new Map<string, number>();
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;

  const nextSlug = (text: string) => {
    const base = slugify(text);
    const count = usedSlugs.get(base) ?? 0;
    usedSlugs.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };

  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index]!)) {
        body.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      nodes.push({ type: "code", language: fence[1] ?? "", value: body.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const text = heading[2]!.trim();
      const id = nextSlug(text);
      const depth = heading[1]!.length;
      headings.push({ depth, id, text });
      nodes.push({ type: "heading", depth, id, text });
      index += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const raw: string[] = [];
      while (index < lines.length && lines[index]!.startsWith(">")) {
        raw.push(lines[index]!.replace(/^>\s?/, ""));
        index += 1;
      }
      const marker = raw[0]?.match(/^\[!(NOTE|TIP|WARNING)\]\s*$/i);
      nodes.push({
        type: "callout",
        tone: marker ? (marker[1]!.toLowerCase() as "note" | "tip" | "warning") : "note",
        text: (marker ? raw.slice(1) : raw).join(" ").trim(),
      });
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(lines[index]!);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index]!)) {
        rows.push(splitTableRow(lines[index]!));
        index += 1;
      }
      nodes.push({ type: "table", headers, rows });
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[2]!);
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index]!.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
        if (!item || /\d+\./.test(item[2]!) !== ordered) break;
        items.push(item[3]!.trim());
        index += 1;
      }
      nodes.push({ type: "list", ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length
      && lines[index]!.trim()
      && !/^(#{1,4})\s+/.test(lines[index]!)
      && !/^```/.test(lines[index]!)
      && !lines[index]!.startsWith(">")
      && !isTableStart(lines, index)
      && !/^(\s*)([-*]|\d+\.)\s+/.test(lines[index]!)
    ) {
      paragraph.push(lines[index]!.trim());
      index += 1;
    }
    nodes.push({ type: "paragraph", text: paragraph.join(" ") });
  }

  return { headings, nodes };
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

function isTableStart(lines: string[], index: number): boolean {
  return Boolean(
    lines[index]?.includes("|")
    && lines[index + 1]
    && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]!),
  );
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}
