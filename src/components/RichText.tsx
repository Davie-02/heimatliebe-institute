import { Fragment, type ReactNode } from "react";

/**
 * Shows text that staff typed, safely: paragraphs from blank lines, "- " lists, **bold** and web
 * links. Nothing is ever inserted as HTML, so a pasted <script> is shown as text, not run.
 */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) out.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    else out.push(<a key={match.index} href={token} target="_blank" rel="noopener noreferrer">{token.replace(/^https?:\/\//, "")}</a>);
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text, className = "" }: { text?: string | null; className?: string }) {
  if (!text) return null;
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
          return <ul key={index}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\s*[-*]\s+/, ""))}</li>)}</ul>;
        }
        if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
          return <ol key={index}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>)}</ol>;
        }
        return <p key={index}>{lines.map((line, i) => <Fragment key={i}>{i > 0 && <br />}{inline(line)}</Fragment>)}</p>;
      })}
    </div>
  );
}
