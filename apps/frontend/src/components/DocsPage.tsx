import { BookOpen, Bot, Hash } from "lucide-preact";
import { docsPageForSlug, docsPages, docsSlugFromPath } from "../docs/docsSource";
import { InlineMarkdown } from "../docs/inlineMarkdown";
import { parseMarkdown, type MarkdownNode } from "../docs/markdown";

type DocsPageProps = {
  pathname?: string | undefined;
};

export function DocsApp() {
  return <DocsPage pathname={typeof window === "undefined" ? "/docs" : window.location.pathname} />;
}

export function DocsPage({ pathname = "/docs" }: DocsPageProps) {
  const activeSlug = docsSlugFromPath(pathname);
  const activePage = docsPageForSlug(activeSlug);
  const parsed = parseMarkdown(activePage.markdown);

  return (
    <div className="playable-starfield relative isolate min-h-dvh overflow-hidden bg-[#05070f] text-slate-100">
      <header className="relative z-20 border-b border-white/10 bg-[#05070f]/90 backdrop-blur">
        <div className="mx-auto flex max-w-[96rem] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <a className="flex items-center gap-2 text-sm font-semibold text-white hover:text-cyan-100" href="/">
            <BookOpen className="h-4 w-4 text-cyan-200" />
            Veydrift Docs
          </a>
          <nav className="flex items-center gap-2 text-xs">
            <a className="inline-flex items-center gap-1 rounded border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 font-semibold text-cyan-100 hover:bg-cyan-300/20" href="/docs.md">
              <Bot className="h-3.5 w-3.5" />
              AI Reference
            </a>
          </nav>
        </div>
      </header>

      <div className="relative z-10 mx-auto grid max-w-[96rem] gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[18rem_minmax(0,1fr)_16rem] lg:py-6">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="border border-white/10 bg-white/[0.04] p-3">
            <p className="px-2 pb-2 text-[11px] font-semibold uppercase text-slate-500">Chapters</p>
            <nav className="grid gap-1">
              {docsPages.map((page) => (
                <a
                  className={`rounded px-2 py-2 text-sm transition ${page.slug === activeSlug ? "bg-cyan-300/15 text-cyan-100" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}
                  href={page.slug === "beginner" ? "/docs" : `/docs/${page.slug}`}
                  key={page.slug}
                >
                  <span className="block text-[10px] font-semibold uppercase text-slate-500">{page.eyebrow}</span>
                  {page.title}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <article className="min-w-0 border border-white/10 bg-white/[0.035]">
          <div className="border-b border-white/10 px-4 py-5 sm:px-6">
            <p className="text-[11px] font-semibold uppercase text-cyan-200">{activePage.eyebrow}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-white sm:text-4xl">{activePage.title}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">{activePage.description}</p>
          </div>
          <div className="docs-prose px-4 py-5 sm:px-6">
            {parsed.nodes.map((node, index) => (
              <MarkdownBlock key={`${node.type}-${index}`} node={node} />
            ))}
          </div>
        </article>

        <aside className="hidden lg:block lg:sticky lg:top-4 lg:self-start">
          <div className="border border-white/10 bg-white/[0.04] p-3">
            <p className="px-2 pb-2 text-[11px] font-semibold uppercase text-slate-500">On this page</p>
            <nav className="grid gap-1">
              {parsed.headings.filter((heading) => heading.depth > 1).map((heading) => (
                <a className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-400 hover:bg-white/10 hover:text-slate-100" href={`#${heading.id}`} key={heading.id}>
                  <Hash className="h-3 w-3 text-slate-600" />
                  {heading.text}
                </a>
              ))}
            </nav>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MarkdownBlock({ node }: { node: MarkdownNode }) {
  if (node.type === "heading") {
    const className = node.depth === 1
      ? "mt-0 text-3xl"
      : node.depth === 2
        ? "mt-9 border-t border-white/10 pt-6 text-2xl"
        : "mt-7 text-xl";
    const content = (
      <a className="group inline-flex items-center gap-2 text-white no-underline" href={`#${node.id}`}>
        <InlineMarkdown text={node.text} />
        <span className="text-sm text-slate-600 opacity-0 transition group-hover:opacity-100">#</span>
      </a>
    );
    if (node.depth === 1) return <h1 className={`${className} font-semibold tracking-normal`} id={node.id}>{content}</h1>;
    if (node.depth === 2) return <h2 className={`${className} font-semibold tracking-normal`} id={node.id}>{content}</h2>;
    return <h3 className={`${className} font-semibold tracking-normal`} id={node.id}>{content}</h3>;
  }

  if (node.type === "paragraph") {
    return <p className="mt-4 text-sm leading-7 text-slate-300"><InlineMarkdown text={node.text} /></p>;
  }

  if (node.type === "list") {
    const Tag = node.ordered ? "ol" : "ul";
    return (
      <Tag className={`mt-4 space-y-2 pl-5 text-sm leading-7 text-slate-300 ${node.ordered ? "list-decimal" : "list-disc"}`}>
        {node.items.map((item) => <li key={item}><InlineMarkdown text={item} /></li>)}
      </Tag>
    );
  }

  if (node.type === "table") {
    return (
      <div className="mt-5 overflow-x-auto border border-white/10">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-white/[0.06] text-[11px] uppercase text-slate-400">
            <tr>{node.headers.map((header) => <th className="border-b border-white/10 px-3 py-2 font-semibold" key={header}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {node.rows.map((row, rowIndex) => (
              <tr className="border-b border-white/5 last:border-0" key={rowIndex}>
                {row.map((cell, cellIndex) => <td className="align-top px-3 py-2 leading-6 text-slate-300" key={`${rowIndex}-${cellIndex}`}><InlineMarkdown text={cell} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (node.type === "code") {
    return <pre className="mt-5 overflow-x-auto border border-cyan-300/20 bg-cyan-950/20 p-4 text-xs leading-6 text-cyan-100"><code>{node.value}</code></pre>;
  }

  const tone = node.tone === "warning" ? "border-amber-300/30 bg-amber-300/10 text-amber-100" : "border-cyan-300/30 bg-cyan-300/10 text-cyan-100";
  return <aside className={`mt-5 border px-4 py-3 text-sm leading-6 ${tone}`}><InlineMarkdown text={node.text} /></aside>;
}
