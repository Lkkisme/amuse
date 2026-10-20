/**
 * Which app actions need the user's approval. Only what is plainly a read
 * runs freely; everything else — sending, changing, deleting, paying, and
 * anything whose name does not say it only reads — is asked about. Judged by
 * the words in the action's name (e.g. GMAIL_FETCH_EMAILS reads).
 */
const readVerbs = new Set(["GET", "LIST", "FETCH", "SEARCH", "FIND", "READ", "QUERY", "LOOKUP", "VIEW", "DESCRIBE", "COUNT", "EXPORT", "DOWNLOAD"]);
const writeWords = new Set([
  "SEND", "SENDS", "REPLY", "FORWARD", "POST", "PUBLISH", "SHARE", "INVITE", "SUBMIT",
  "CREATE", "INSERT", "ADD", "APPEND", "UPLOAD", "UPDATE", "UPSERT", "EDIT", "MODIFY", "PATCH", "SET", "REPLACE", "MOVE", "RENAME",
  "DELETE", "REMOVE", "TRASH", "ARCHIVE", "CLEAR", "CANCEL",
  "BOOK", "PAY", "PURCHASE", "BUY", "ORDER", "APPROVE", "MERGE", "CLOSE", "EXECUTE", "RUN", "TRIGGER",
]);

export function consequential(action: string): boolean {
  const words = action.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  const reads = words.some((w) => readVerbs.has(w));
  const writes = words.some((w) => writeWords.has(w));
  return writes || !reads;
}
