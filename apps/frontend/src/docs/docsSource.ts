import docsMarkdown from "./content/docs.md?raw";

export type DocsPageSlug = "beginner" | "concepts" | "catalogs" | "formulas" | "mechanics";

export type DocsPageSource = {
  slug: DocsPageSlug;
  title: string;
  eyebrow: string;
  description: string;
  markdown: string;
};

type DocsPageDefinition = Omit<DocsPageSource, "markdown">;

export const docsMarkdownSource = docsMarkdown;

const docsPageDefinitions: DocsPageDefinition[] = [
  {
    slug: "beginner",
    title: "Beginner Tutorial",
    eyebrow: "Start here",
    description: "Connect, settle, read resources, build the first economy, and launch early missions.",
  },
  {
    slug: "concepts",
    title: "Concepts And Mechanics",
    eyebrow: "Rules",
    description: "Planets, moons, queues, combat, loot, protection, alliances, rankings, and testnet limits.",
  },
  {
    slug: "catalogs",
    title: "Catalogs",
    eyebrow: "Reference",
    description: "Infrastructure, research, ships, defenses, missiles, and moon structures.",
  },
  {
    slug: "formulas",
    title: "Formulas",
    eyebrow: "Math",
    description: "Production, energy, storage, construction time, flight, fuel, combat, protection, and moon formulas.",
  },
  {
    slug: "mechanics",
    title: "Action Mechanics",
    eyebrow: "Transactions",
    description: "What each transaction does and what state changes after indexing.",
  },
];

export const docsPages: DocsPageSource[] = docsPageDefinitions.map((page) => ({
  ...page,
  markdown: markdownSectionForHeading(docsMarkdownSource, page.title),
}));

export function docsPageForSlug(slug: string | undefined): DocsPageSource {
  return docsPages.find((page) => page.slug === slug) ?? docsPages[0]!;
}

export function docsSlugFromPath(pathname: string): DocsPageSlug {
  const normalized = pathname.replace(/\/+$/, "");
  const tail = normalized.split("/").filter(Boolean).at(-1);
  if (tail && docsPages.some((page) => page.slug === tail)) return tail as DocsPageSlug;
  return "beginner";
}

function markdownSectionForHeading(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return markdown;

  const next = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  const end = next === -1 ? lines.length : next;
  return `${lines.slice(start, end).join("\n").trim()}\n`;
}
