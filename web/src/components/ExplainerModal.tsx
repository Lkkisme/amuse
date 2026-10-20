/**
 * Pre-connect explainer bottom sheet (surface 10): opened from a
 * connection-request card. 1:1 with the Muse sheet: drag handle, app icon,
 * title, subtitle, three icon feature rows, disclaimer paragraphs with links,
 * full-width Connect button and a Cancel text button. Confirm walks the card
 * to connected; dismiss returns it to pending.
 */
import { BarChart3, Eye, ToggleLeft, X } from "lucide-react";
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
  const close = () => actions.dismissConnect(req.id);
  const features = [
    {
      icon: BarChart3,
      title: `Level up with ${req.app}`,
      body: `Muse will access things like ${req.capability.toLowerCase()} and metadata.`,
    },
    {
      icon: ToggleLeft,
      title: "You choose what Muse can do",
      body: "By default, Muse will ask before taking actions it thinks need review. Disconnect at any time in Settings.",
    },
    {
      icon: Eye,
      title: "Keep an eye on things",
      body: "Muse may take unexpected actions. Monitor it carefully.",
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={close} />
      <div
        className="anim-modal-in relative flex max-h-[92vh] w-full max-w-sm flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl"
        style={{ background: "var(--fill-primary)", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}
      >
        {/* drag handle */}
        <div className="flex shrink-0 justify-center pt-2.5">
          <span className="h-1.5 w-9 rounded-full" style={{ background: "var(--fill-tertiary)" }} />
        </div>

        <div className="overflow-y-auto px-6 pb-2 pt-5 text-center">
          <button
            aria-label="Close"
            className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full"
            style={{ background: "var(--fill-secondary)", color: "var(--icon-primary)" }}
            onClick={close}
          >
            <X size={16} />
          </button>

          {/* app icon */}
          <span
            className="mx-auto flex size-16 items-center justify-center rounded-2xl"
            style={{ background: "var(--fill-primary)", boxShadow: "0 1px 6px rgba(0,0,0,0.10)" }}
          >
            <BarChart3 size={30} style={{ color: "var(--fill-green)" }} />
          </span>
          <p className="mt-3 text-[24px] font-bold" style={{ color: "var(--text-primary)" }}>
            {req.app}
          </p>
          <p className="mt-1 text-[16px]" style={{ color: "var(--text-secondary)" }}>
            Access and edit your {req.capability.replace(/^read\s+/i, "").toLowerCase()}
          </p>

          {/* feature rows */}
          <div className="mt-5 flex flex-col gap-4 text-left">
            {features.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-3.5">
                <Icon size={22} className="mt-0.5 shrink-0" style={{ color: "var(--text-primary)" }} />
                <div>
                  <p className="text-[16px] font-semibold" style={{ color: "var(--text-primary)" }}>
                    {title}
                  </p>
                  <p className="mt-0.5 text-[14px] leading-snug" style={{ color: "var(--text-secondary)" }}>
                    {body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* disclaimers + actions */}
        <div
          className="shrink-0 border-t px-6 pb-4 pt-3 text-left text-[12.5px] leading-snug"
          style={{ borderColor: "var(--fill-divider)", color: "var(--text-secondary)" }}
        >
          <p>
            The info used for your tasks is part of your interactions with Muse. You can manage
            this in Settings. <span style={{ color: "var(--fill-blue)" }}>Learn more</span>
          </p>
          <p className="mt-1.5">
            Muse will exchange info with {req.app}. To learn more, view their{" "}
            <span style={{ color: "var(--fill-blue)" }}>terms</span> and{" "}
            <span style={{ color: "var(--fill-blue)" }}>privacy policy</span>.
          </p>
          <button
            className="mt-3.5 h-12 w-full rounded-full text-[16px] font-semibold text-white"
            style={{ background: "var(--fill-blue)" }}
            onClick={() => actions.confirmConnect(req.id)}
          >
            Connect
          </button>
          <button
            className="mx-auto mt-2 block py-2 text-[16px] font-semibold"
            style={{ color: "var(--text-primary)" }}
            onClick={close}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
