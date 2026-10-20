/**
 * Tiny rich-markdown renderer for agent bubbles: **bold**, `inline code`
 * chips, and "- " bullets. Hand-parsed (no dangerouslySetInnerHTML).
 */
import type { ReactNode } from "react";

function renderInline(text: string, keyBase: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-i${i++}`;
    if (tok.startsWith("**")) {
      parts.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else {
      parts.push(
        <code
          key={key}
          className="rounded px-1 py-0.5 text-[13px]"
          style={{ background: "var(--fill-tertiary)", fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
        >
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let bullets: ReactNode[] = [];

  const flushBullets = (key: string) => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={key} className="my-1 ml-4 list-disc space-y-0.5">
        {bullets}
      </ul>,
    );
    bullets = [];
  };

  lines.forEach((line, i) => {
    if (line.startsWith("- ")) {
      bullets.push(<li key={`b${i}`}>{renderInline(line.slice(2), `l${i}`)}</li>);
    } else {
      flushBullets(`u${i}`);
      if (line.trim()) {
        blocks.push(<p key={`p${i}`}>{renderInline(line, `l${i}`)}</p>);
      }
    }
  });
  flushBullets("u-end");

  return <>{blocks}</>;
}
