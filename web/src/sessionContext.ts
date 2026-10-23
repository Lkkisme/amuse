/**
 * The session, for a card that must ask the server itself (the card for a service's key opens its sign-in sheet,
 * which talks to the server as Settings' does). Everything else a card does goes through Actions.
 */
import { createContext, useContext } from "react";
import type { Session } from "@amuse/protocol";

export const SessionContext = createContext<Session | null>(null);
export const useSession = () => useContext(SessionContext);
