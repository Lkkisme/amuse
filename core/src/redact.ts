/**
 * Error text safe to show in the chat or a log: no credential-looking
 * strings and no paths to credential files.
 */
export function redact(text: string, paths: readonly (string | undefined)[] = [], empty = "The model run failed"): string {
  let out = text;
  for (const path of paths) if (path) out = out.split(path).join("<pi-file>");
  return (
    out
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 <redacted>")
      .replace(/\b(sk|pk|rk|key|tok|ghp|gho|xox[a-z])[-_][A-Za-z0-9_-]{12,}/g, "<redacted>")
      .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "<redacted>")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500) || empty
  );
}
