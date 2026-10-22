/**
 * Pre-connect explainer bottom sheet (surface 10): opened from a
 * connection-request card. Muse-style sheet: app icon,
 * title, subtitle, three icon feature rows, disclaimer paragraphs with links,
 * full-width Connect button and a Cancel text button. Connect asks the server
 * to begin connecting; Cancel only closes the sheet.
 */
import { BarChart3, Eye, ToggleLeft } from "lucide-react";
import type { Connection, State } from "@amuse/protocol";
import type { Actions } from "../ui.ts";
import { byId, providerLogo } from "../view.ts";
import { useT } from "../i18n/react.ts";
import { Sheet } from "./Sheet";
import { AppLogo } from "./AppLogo";
import { useLastValue } from "./usePresence";

export function ExplainerModal({ conversation, open, actions }: { conversation: State; open: string | null; actions: Actions }) {
  // keep showing the last request while the sheet animates out
  const req = byId(conversation, "connection", useLastValue(open));
  if (!req) return null;
  return <ExplainerBody req={req} open={open !== null} actions={actions} />;
}

function ExplainerBody({ req, open, actions }: { req: Connection; open: boolean; actions: Actions }) {
  const t = useT();
  const close = () => actions.openExplainer(null);
  const features = [
    {
      icon: BarChart3,
      title: t.explainer.dataTitle(req.title),
      body: t.explainer.dataBody(req.title),
    },
    {
      icon: ToggleLeft,
      title: t.explainer.chooseTitle,
      body: t.explainer.chooseBody,
    },
    {
      icon: Eye,
      title: t.explainer.watchTitle,
      body: t.explainer.watchBody,
    },
  ];

  return (
    <Sheet open={open} onClose={close}>
        <div className="overflow-y-auto px-6 pb-2 pt-5 text-center">
          {/* app icon */}
          <span className="mx-auto flex w-fit">
            <AppLogo name={req.title} logo={providerLogo(req.provider)} size={64} />
          </span>
          <p className="mt-3 text-[24px] font-bold" style={{ color: "var(--text-primary)" }}>
            {req.title}
          </p>
          <p className="mt-1 text-[16px]" style={{ color: "var(--text-secondary)" }}>
            {t.explainer.kind}
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

        {/* actions (self-hosted: no data-collection disclaimers) */}
        <div
          className="shrink-0 border-t px-6 pb-4 pt-3 text-left"
          style={{ borderColor: "var(--fill-divider)" }}
        >
          <button
            className="mt-3.5 h-12 w-full rounded-full text-[16px] font-semibold text-white"
            style={{ background: "var(--fill-blue)" }}
            onClick={() => actions.connect(req.id)}
          >
            {t.explainer.connect}
          </button>
          <button
            className="mx-auto mt-2 block py-2 text-[16px] font-semibold"
            style={{ color: "var(--text-primary)" }}
            onClick={close}
          >
            {t.common.cancel}
          </button>
        </div>
    </Sheet>
  );
}
