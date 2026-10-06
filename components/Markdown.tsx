"use client";

import { Fragment } from "react";

// Minimal, safe Markdown for agent deliverables: headings, lists, bold,
// italics, inline code, links shown as text. No HTML is ever injected.

function inline(text: string, key: string) {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|_[^_]+_|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith("**")) parts.push(<strong key={k} className="font-semibold text-ink">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) parts.push(<code key={k} className="rounded bg-card-2 px-1 py-0.5 text-[0.92em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const label = tok.slice(1, tok.indexOf("]"));
      const href = tok.slice(tok.indexOf("(") + 1, -1);
      parts.push(
        /^https?:\/\//.test(href) ? (
          <a key={k} href={href} target="_blank" rel="noreferrer noopener" className="text-ai underline-offset-2 hover:underline">{label}</a>
        ) : (
          label
        ),
      );
    } else parts.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = (k: number) => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`l${k}`} className={list.ordered ? "ml-5 list-decimal space-y-1" : "ml-5 list-disc space-y-1"}>
        {list.items.map((it, j) => (
          <li key={j}>{inline(it, `li${k}-${j}`)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  lines.forEach((raw, k) => {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const ordered = Boolean(ol);
      if (list && list.ordered !== ordered) flush(k);
      list ??= { ordered, items: [] };
      list.items.push((ul ?? ol)![1]);
      return;
    }
    flush(k);
    if (!line.trim()) return;
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      blocks.push(
        <div key={k} className="pt-2 text-[14px] font-semibold text-ink">
          {inline(h[2], `h${k}`)}
        </div>,
      );
      return;
    }
    blocks.push(<p key={k}>{inline(line, `p${k}`)}</p>);
  });
  flush(lines.length);
  return <div className="space-y-2 text-[13px] leading-relaxed text-ink-2">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
