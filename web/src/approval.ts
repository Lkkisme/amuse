/** One argument of an action, as its approval card lists it; `label` is null for text that is not "Field: value". */
export interface Parameter {
  label: string | null;
  value: string;
}

/** What an approval card shows: the reason, and the raw parameters kept behind its Details. */
export interface Split {
  reason: string;
  parameters: Parameter[];
}

const LABELLED = /^([A-Z][^:\n]{0,39}): ?(.*)$/;

/** "Field: value" lines; a line that is not one carries on the value above it (a message of several lines). */
function listed(text: string): Parameter[] {
  const rows: Parameter[] = [];
  for (const line of text.split("\n")) {
    const found = LABELLED.exec(line);
    const last = rows.at(-1);
    if (found?.[1] !== undefined) rows.push({ label: found[1], value: found[2] ?? "" });
    else if (last) last.value += `\n${line}`;
    else rows.push({ label: null, value: line });
  }
  return rows;
}

const lead = (text: string) => LABELLED.test(text.split("\n")[0] ?? "");

/**
 * An approval's `detail` is the reason, then (after a blank line) the arguments one "Field: value" a line.
 * Anything else (a sentence about what will happen, a list of memories) is the reason, in full.
 */
export function splitDetail(detail: string): Split {
  const text = detail.trim();
  const gap = text.search(/\n[ \t]*\n/);
  if (gap === -1) {
    const lines = text.split("\n");
    return lines.length > 1 && lines.every((l) => LABELLED.test(l)) ? { reason: "", parameters: listed(text) } : { reason: text, parameters: [] };
  }
  const rest = text.slice(gap).trim();
  if (!lead(rest)) return { reason: text, parameters: [] };
  return { reason: text.slice(0, gap).trim(), parameters: listed(rest) };
}
