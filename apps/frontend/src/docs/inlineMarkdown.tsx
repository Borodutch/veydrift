import type { ComponentChildren } from "preact";

export function InlineMarkdown({ text }: { text: string }) {
  return <>{renderInline(text)}</>;
}

export function renderInline(text: string): ComponentChildren[] {
  const nodes: ComponentChildren[] = [];
  const pattern = /(`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[2]) {
      nodes.push(<code className="rounded bg-cyan-300/10 px-1 py-0.5 text-cyan-100">{match[2]}</code>);
    } else if (match[3] && match[4]) {
      nodes.push(
        <a className="text-cyan-200 underline decoration-cyan-300/40 underline-offset-4 hover:text-cyan-100" href={match[4]}>
          {match[3]}
        </a>,
      );
    } else if (match[5]) {
      nodes.push(<strong className="font-semibold text-slate-100">{match[5]}</strong>);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
