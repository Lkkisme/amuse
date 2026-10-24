/**
 * Pre-connect explainer bottom sheet (surface 10): opened from a
 * connection-request card. Muse-style sheet: app icon,
 * title, subtitle, three icon feature rows, disclaimer paragraphs with links,
 * full-width Connect button and a Cancel text button. Connect asks the server
 * to begin connecting; Cancel only closes the sheet.
 */
import { useEffect, useState } from "react";
import { BarChart3, Eye, ToggleLeft } from "lucide-react";
import type { AppAccess, Connection, State } from "@amuse/protocol";
import type { Actions } from "../ui.ts";
import { byId, providerLogo } from "../view.ts";
import { useT } from "../i18n/react.ts";
import { Button } from "./Button";
import { Sheet } from "./Sheet";
import { AppLogo } from "./AppLogo";
import { KeyConnect } from "./KeyConnect";
import { wordsFor } from "../shown.ts";
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
  // an app that takes the user's own key asks for it here instead of opening a link
  const [access, setAccess] = useState<AppAccess | null>(null);
  const [unfit, setUnfit] = useState<unknown>(null);
  const { provider } = req;
  useEffect(() => {
    let current = true;
    setAccess(null);
    setUnfit(null);
    actions.appAccess(provider).then(
      (found) => current && setAccess(found),
      (e: unknown) => current && setUnfit(e),
    );
    return () => {
      current = false;
    };
  }, [actions, provider]);
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
          {unfit !== null && (
            <p role="alert" className="mt-3 text-[13px]" style={{ color: "var(--fill-red)" }}>
              {wordsFor(unfit, t)}
            </p>
          )}
          {access?.kind === "key" ? (
            <div className="mt-3.5">
              <KeyConnect
                app={req.title}
                label={access.label}
                size="lg"
                connect={async (key) => {
                  await actions.connectKey(provider, key);
                  close();
                }}
              />
            </div>
          ) : (
            <Button
              variant="primary"
              size="lg"
              className="mt-3.5"
              disabled={access === null && unfit === null}
              onClick={() => actions.connect(req.id)}
            >
              {t.explainer.connect}
            </Button>
          )}
          <Button variant="plain" size="lg" className="mt-2" onClick={close}>
            {t.common.cancel}
          </Button>
        </div>
    </Sheet>
  );
}
