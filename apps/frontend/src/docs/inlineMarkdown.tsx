import type { ComponentChildren } from "preact";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** `compact` (table cells) shortens a full 0x address link to 0x1234…abcd; the link and title keep it whole. */
export function InlineMarkdown({ text, compact = false }: { text: string; compact?: boolean }) {
  return <>{renderInline(text, compact)}</>;
}

export function renderInline(text: string, compact = false): ComponentChildren[] {
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
        // A full 0x address can't wrap: in a table it would take the width and squeeze the text columns
        // to a word per line, so cells show it shortened.
        ADDRESS.test(match[3]) ? (
          <a aria-label={match[3]} className="whitespace-nowrap font-mono text-xs text-cyan-200 underline decoration-cyan-300/40 underline-offset-4 hover:text-cyan-100" href={match[4]} title={match[3]}>
            {compact ? `${match[3].slice(0, 6)}…${match[3].slice(-4)}` : match[3]}
          </a>
        ) : (
          <a className="text-cyan-200 underline decoration-cyan-300/40 underline-offset-4 hover:text-cyan-100" href={match[4]}>
            {match[3]}
          </a>
        ),
      );
    } else if (match[5]) {
      nodes.push(<strong className="font-semibold text-slate-100">{match[5]}</strong>);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
