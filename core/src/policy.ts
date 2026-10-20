/**
 * Which app actions need the user's approval. Rakazo-level and lenient:
 * reading is free; a step that sends, changes, deletes or pays is asked
 * about. Judged by the verbs in the action's name (e.g. GMAIL_SEND_EMAIL).
 */
const consequentialVerbs = new Set([
  "SEND", "REPLY", "FORWARD", "POST", "PUBLISH", "SHARE", "INVITE",
  "CREATE", "INSERT", "ADD", "UPDATE", "EDIT", "PATCH", "SET", "MOVE", "RENAME",
  "DELETE", "REMOVE", "TRASH", "ARCHIVE", "CLEAR",
  "BOOK", "PAY", "PURCHASE", "BUY", "ORDER", "APPROVE", "MERGE", "CLOSE",
]);

export function consequential(action: string): boolean {
  return action.toUpperCase().split(/[^A-Z]+/).some((word) => consequentialVerbs.has(word));
}
