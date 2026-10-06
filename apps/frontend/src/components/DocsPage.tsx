import { Bot, GitFork } from "lucide-preact";
import { SiteHeader } from "./SiteHeader";
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

  // The page header already shows the chapter title; skip the markdown's duplicate of it.
  const first = parsed.nodes[0];
  const nodes = first?.type === "heading" && first.text.trim().toLowerCase() === activePage.title.trim().toLowerCase() ? parsed.nodes.slice(1) : parsed.nodes;
  const tocHeadings = parsed.headings.filter((heading) => heading.depth > 1 && heading.text.trim().toLowerCase() !== activePage.title.trim().toLowerCase());
  const tocBaseDepth = Math.min(...tocHeadings.map((heading) => heading.depth));

  return (
    <div className="playable-starfield relative isolate min-h-dvh overflow-hidden bg-[#060b16] text-slate-100">
      <SiteHeader current="docs" wide />

      <div className="relative z-10 mx-auto grid max-w-[96rem] gap-5 px-3 py-4 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)_14rem] lg:gap-8 lg:py-8">
        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <p className="mb-2 hidden px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300/70 lg:block">Chapters</p>
          <nav aria-label="Docs chapters" className="-mx-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] lg:mx-0 lg:grid lg:gap-0.5 lg:overflow-visible lg:px-0">
            {docsPages.map((page) => {
              const active = page.slug === activeSlug;
              return (
                <a
                  aria-current={active ? "page" : undefined}
                  className={`relative shrink-0 rounded-md px-3 py-2 text-sm transition lg:px-2.5 ${active
                    ? "bg-cyan-400/[0.08] text-cyan-100 lg:before:absolute lg:before:inset-y-2 lg:before:left-0 lg:before:w-0.5 lg:before:rounded-full lg:before:bg-cyan-300"
                    : "surface-inset text-slate-300 hover:text-white lg:border-transparent lg:bg-transparent lg:hover:bg-white/[0.04]"}`}
                  href={page.slug === "beginner" ? "/docs" : `/docs/${page.slug}`}
                  key={page.slug}
                >
                  <span className={`block text-[10px] font-semibold uppercase tracking-[0.12em] ${active ? "text-cyan-300/80" : "text-slate-500"}`}>{page.eyebrow}</span>
                  <span className="whitespace-nowrap lg:whitespace-normal">{page.title}</span>
                </a>
              );
            })}
          </nav>
          <div className="mt-5 hidden gap-0.5 border-t border-cyan-300/10 pt-4 text-xs lg:grid">
            <a className="inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 font-medium text-slate-300 transition hover:bg-white/[0.04] hover:text-white" href="/docs.md">
              <Bot className="h-3.5 w-3.5 text-cyan-300" />
              AI Reference
            </a>
            <a
              aria-label="Veydrift GitHub repository"
              className="inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 font-medium text-slate-300 transition hover:bg-white/[0.04] hover:text-white"
              href="https://github.com/Borodutch/veydrift"
              rel="noopener noreferrer"
              target="_blank"
              title="Veydrift GitHub repository"
            >
              <GitFork className="h-3.5 w-3.5 text-cyan-300" />
              GitHub
            </a>
          </div>
        </aside>

        <article className="surface min-w-0 rounded-xl">
          <div className="border-b border-cyan-300/10 px-5 py-6 sm:px-8 sm:py-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300/80">{activePage.eyebrow}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-white sm:text-4xl">{activePage.title}</h1>
            <p className="mt-3 max-w-2xl text-[15px] leading-7 text-slate-300">{activePage.description}</p>
          </div>
          <div className="docs-prose max-w-[52rem] px-5 pb-8 pt-2 sm:px-8">
            {nodes.map((node, index) => (
              <MarkdownBlock key={`${node.type}-${index}`} node={node} />
            ))}
          </div>
        </article>

        <aside className="hidden lg:sticky lg:top-20 lg:block lg:self-start">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300/70">On this page</p>
          <nav aria-label="On this page" className="grid border-l border-cyan-300/10">
            {tocHeadings.map((heading) => (
              <a
                className={`-ml-px border-l border-transparent py-1.5 text-xs text-slate-400 transition hover:border-cyan-300/60 hover:text-slate-100 ${heading.depth > tocBaseDepth ? "pl-6" : "pl-3"}`}
                href={`#${heading.id}`}
                key={heading.id}
              >
                {heading.text}
              </a>
            ))}
          </nav>
        </aside>
      </div>
    </div>
  );
}

function MarkdownBlock({ node }: { node: MarkdownNode }) {
  if (node.type === "heading") {
    const className = node.depth === 1
      ? "mt-8 text-3xl"
      : node.depth === 2
        ? "mt-10 scroll-mt-20 border-t border-cyan-300/10 pt-8 text-2xl"
        : "mt-8 scroll-mt-20 text-lg";
    const content = (
      <a className="group inline-flex items-center gap-2 text-white no-underline" href={`#${node.id}`}>
        <InlineMarkdown text={node.text} />
        <span className="text-sm text-cyan-300/60 opacity-0 transition group-hover:opacity-100">#</span>
      </a>
    );
    if (node.depth === 1) return <h1 className={`${className} font-semibold tracking-normal`} id={node.id}>{content}</h1>;
    if (node.depth === 2) return <h2 className={`${className} font-semibold tracking-normal`} id={node.id}>{content}</h2>;
    return <h3 className={`${className} font-semibold tracking-normal`} id={node.id}>{content}</h3>;
  }

  if (node.type === "paragraph") {
    return <p className="mt-4 text-[15px] leading-7 text-slate-300"><InlineMarkdown text={node.text} /></p>;
  }

  if (node.type === "list") {
    const Tag = node.ordered ? "ol" : "ul";
    return (
      <Tag className={`mt-4 space-y-1.5 pl-5 text-[15px] leading-7 text-slate-300 marker:text-cyan-300/70 ${node.ordered ? "list-decimal" : "list-disc"}`}>
        {node.items.map((item) => <li key={item}><InlineMarkdown text={item} /></li>)}
      </Tag>
    );
  }

  if (node.type === "table") {
    return (
      <div className="surface-inset mt-6 overflow-x-auto rounded-lg">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="text-[10px] uppercase tracking-[0.12em] text-cyan-300/70">
            <tr>{node.headers.map((header) => <th className="border-b border-cyan-300/10 px-3 py-2.5 font-semibold" key={header}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {node.rows.map((row, rowIndex) => (
              <tr className="border-b border-cyan-300/[0.06] last:border-0" key={rowIndex}>
                {row.map((cell, cellIndex) => <td className="align-top px-3 py-2 leading-6 text-slate-300" key={`${rowIndex}-${cellIndex}`}><InlineMarkdown text={cell} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (node.type === "code") {
    return <pre className="mt-6 overflow-x-auto rounded-lg border border-cyan-300/15 bg-[#081120] p-4 text-xs leading-6 text-cyan-100"><code>{node.value}</code></pre>;
  }

  const tone = node.tone === "warning" ? "border-amber-300 bg-amber-300/[0.07] text-amber-100" : "border-cyan-300 bg-cyan-300/[0.07] text-cyan-100";
  return <aside className={`mt-6 rounded-r-lg border-l-2 px-4 py-3 text-sm leading-6 ${tone}`}><InlineMarkdown text={node.text} /></aside>;
}
