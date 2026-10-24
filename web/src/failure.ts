/**
 * A page's error line. What a call threw is kept as it came, said in the app's words (`wordsFor`), and a drop does
 * not stand once the connection is back: the session says the chats again on every reconnect.
 */
import { useEffect, useState } from "react";
import type { Session } from "@amuse/protocol";
import { standsAfterReturn } from "./shown.ts";

export function useFailure(session: Session): [unknown, (error: unknown) => void] {
  const [error, setError] = useState<unknown>(null);
  useEffect(
    () =>
      session.subscribe((update) => {
        if (update.kind === "chats") setError(standsAfterReturn);
      }),
    [session],
  );
  return [error, setError];
}
