/**
 * Tiny rich-markdown renderer for agent bubbles: **bold**, `inline code`
 * chips, [links](https://…), "# " headings (as bold lines), "- " bullets and
 * ``` code blocks (as they are, in a mono box).
 * Hand-parsed (no dangerouslySetInnerHTML); a link goes only to http(s).
 */
import type { ReactNode } from "react";

function renderInline(text: string, keyBase: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-i${i++}`;
    if (tok.startsWith("**")) {
      parts.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("[")) {
      const at = tok.indexOf("](");
      parts.push(
        <a key={key} href={tok.slice(at + 2, -1)} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--fill-blue)" }}>
          {tok.slice(1, at)}
        </a>,
      );
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

  /** a blank line came before: the next block starts a new paragraph, 8px down (Muse) */
  let paragraph = false;
  /** the lines of a ``` block being read, or null outside one */
  let code: string[] | null = null;
  for (const [i, line] of lines.entries()) {
    if (line.trimStart().startsWith("```")) {
      if (code === null) {
        flushBullets(`u${i}`);
        code = [];
      } else {
        blocks.push(
          <pre
            key={`c${i}`}
            className="my-2 overflow-x-auto rounded-xl px-3 py-2 text-[13px] leading-[19px]"
            style={{ background: "var(--fill-secondary)", fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
          >
            {code.join("\n")}
          </pre>,
        );
        code = null;
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    if (line.startsWith("- ")) {
      bullets.push(<li key={`b${i}`}>{renderInline(line.slice(2), `l${i}`)}</li>);
    } else {
      flushBullets(`u${i}`);
      if (line.trim()) {
        const heading = line.match(/^#{1,6}\s+(.*)$/);
        blocks.push(
          <p key={`p${i}`} className={`${paragraph && blocks.length > 0 ? "mt-3" : ""} ${heading ? "font-semibold" : ""}`.trim() || undefined}>
            {renderInline(heading?.[1] ?? line, `l${i}`)}
          </p>,
        );
        paragraph = false;
      } else paragraph = true;
    }
  }
  flushBullets("u-end");
  // a block never closed: what was in it, as it is
  const open = code;
  if (open !== null)
    blocks.push(
      <pre key="c-end" className="my-2 overflow-x-auto rounded-xl px-3 py-2 text-[13px]" style={{ background: "var(--fill-secondary)" }}>
        {open.join("\n")}
      </pre>,
    );

  return <>{blocks}</>;
}
