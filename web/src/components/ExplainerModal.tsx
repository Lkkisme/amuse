/**
 * Pre-connect explainer modal (surface 10): opened from a connection-request
 * card. Confirm walks the card to connected; dismiss returns it to pending.
 */
import { Check, X } from "lucide-react";
import type { ConnectionRequest, DemoState } from "../data/fakeMuse";
import type { MuseActions } from "./actions";

export function ExplainerModal({ state, actions }: { state: DemoState; actions: MuseActions }) {
  if (!state.explainerFor) return null;
  const req = state.feed.find(
    (i): i is Extract<typeof i, { role: "card"; kind: "connreq" }> =>
      i.role === "card" && i.kind === "connreq" && i.connreq.id === state.explainerFor,
  )?.connreq;
  if (!req) return null;
  return <ExplainerBody req={req} actions={actions} />;
}

function ExplainerBody({ req, actions }: { req: ConnectionRequest; actions: MuseActions }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/30" onClick={() => actions.dismissConnect(req.id)} />
      <div
        className="anim-modal-in relative w-full max-w-sm rounded-t-2xl p-6 text-center sm:rounded-2xl"
        style={{ background: "var(--fill-primary)", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}
      >
        <button
          aria-label="Close"
          className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full"
          style={{ background: "var(--fill-secondary)", color: "var(--icon-primary)" }}
          onClick={() => actions.dismissConnect(req.id)}
        >
          <X size={16} />
        </button>

        <span
          className="mx-auto flex size-14 items-center justify-center rounded-2xl text-white"
          style={{ background: "var(--fill-blue)" }}
        >
          <Check size={26} />
        </span>
        <p className="mt-3 text-[19px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Connect {req.app}?
        </p>
        <p className="mt-2 text-[14px] leading-snug" style={{ color: "var(--text-secondary)" }}>
          Muse is asking to connect to {req.app} so it can {req.capability.toLowerCase()}. Muse can only do
          what you allow, and you can disconnect or change permissions at any time in Settings.
        </p>

        <div className="mt-5 flex flex-col gap-2">
          <button
            className="h-11 rounded-full text-[15px] font-semibold text-white"
            style={{ background: "var(--fill-blue)" }}
            onClick={() => actions.confirmConnect(req.id)}
          >
            Connect
          </button>
          <button
            className="h-11 rounded-full text-[15px] font-semibold"
            style={{ background: "var(--fill-secondary)", color: "var(--text-primary)" }}
            onClick={() => actions.dismissConnect(req.id)}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
