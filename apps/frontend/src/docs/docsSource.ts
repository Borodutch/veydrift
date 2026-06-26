import ai from "./content/ai.md?raw";
import beginner from "./content/beginner.md?raw";
import catalogs from "./content/catalogs.md?raw";
import concepts from "./content/concepts.md?raw";
import formulas from "./content/formulas.md?raw";
import mechanics from "./content/mechanics.md?raw";

export type DocsPageSlug = "beginner" | "concepts" | "catalogs" | "formulas" | "mechanics" | "ai";

export type DocsPageSource = {
  slug: DocsPageSlug;
  title: string;
  eyebrow: string;
  description: string;
  markdown: string;
};

export const docsPages: DocsPageSource[] = [
  {
    slug: "beginner",
    title: "Beginner Tutorial",
    eyebrow: "Start here",
    description: "Connect, settle, read resources, build the first economy, and launch early missions.",
    markdown: beginner,
  },
  {
    slug: "concepts",
    title: "Concepts And Mechanics",
    eyebrow: "Rules",
    description: "Planets, moons, queues, combat, loot, protection, alliances, rankings, and testnet limits.",
    markdown: concepts,
  },
  {
    slug: "catalogs",
    title: "Catalogs",
    eyebrow: "Reference",
    description: "Infrastructure, research, ships, defenses, missiles, and moon structures.",
    markdown: catalogs,
  },
  {
    slug: "formulas",
    title: "Formulas",
    eyebrow: "Math",
    description: "Production, energy, storage, construction time, flight, fuel, combat, protection, and moon formulas.",
    markdown: formulas,
  },
  {
    slug: "mechanics",
    title: "Action Mechanics",
    eyebrow: "Transactions",
    description: "What each transaction does and what state changes after indexing.",
    markdown: mechanics,
  },
  {
    slug: "ai",
    title: "Veydrift AI Reference",
    eyebrow: "Shareable",
    description: "A concise rules reference users can give to AI assistants.",
    markdown: ai,
  },
];

export function docsPageForSlug(slug: string | undefined): DocsPageSource {
  return docsPages.find((page) => page.slug === slug) ?? docsPages[0]!;
}

export function docsSlugFromPath(pathname: string): DocsPageSlug {
  const normalized = pathname.replace(/\/+$/, "");
  const tail = normalized.split("/").filter(Boolean).at(-1);
  if (tail === "agents") return "ai";
  if (tail && docsPages.some((page) => page.slug === tail)) return tail as DocsPageSlug;
  return "beginner";
}
