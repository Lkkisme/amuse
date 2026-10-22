/**
 * Settings (surfaces 7, 9, 10): a page on a phone, a modal with a nav column on
 * a desktop — General (appearance; the password), Models (the user's keys and
 * the models chosen: Models.tsx), Connectors (the server's app directory: Connectors.tsx),
 * Permissions (per-site Allow/Ask/Deny) and Schedules. Modeled on the reference
 * settings sheet. (Muse's secure store is left out: the browser keeps logins
 * from the user's own sign-ins instead.)
 */
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Globe,
  LayoutGrid,
  Plus,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  X,
  CalendarClock,
} from "lucide-react";
import type { BackendStatus as Backend, Session } from "@amuse/protocol";
import type { Actions, SettingsSection, Theme, Ui } from "../ui.ts";
import { THEMES } from "../theme.ts";
import { usePresence } from "./usePresence";
import { barButton, barButtonLook, barIcon } from "./bar";
import { AppsKey } from "./AppsKey";
import { SitePermissions } from "./SitePermissions";
import { Schedules } from "./Schedules";
import { Models } from "./Models";
import { PinSecurity } from "./PinSecurity";
import { BackendStatus, useBackendStatus } from "./BackendStatus";

const NAV: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <SettingsIcon size={18} /> },
  { id: "models", label: "Models", icon: <Sparkles size={18} /> },
  { id: "connectors", label: "Connectors", icon: <LayoutGrid size={18} /> },
  { id: "permissions", label: "Permissions", icon: <Shield size={18} /> },
  { id: "schedules", label: "Schedules", icon: <CalendarClock size={18} /> },
];

/* ---------------- General ---------------- */

const themeName: Record<Theme, string> = {
  system: "Match system",
  light: "Light",
  dark: "Dark",
};

function GeneralSection({
  theme,
  server,
  actions,
  backend,
  backendLoading,
  backendUnavailable,
}: {
  theme: Theme;
  /** there is a server, with a password (not the in-browser demo) */
  server: boolean;
  actions: Actions;
  backend: Backend | null;
  backendLoading: boolean;
  backendUnavailable: boolean;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <BackendStatus backend={backend} loading={backendLoading} unavailable={backendUnavailable} />
      <p
        className="mb-2 text-[15px] font-semibold"
        style={{ color: "var(--text-primary)" }}
      >
        Appearance
      </p>
      <div
        className="overflow-hidden rounded-xl"
        style={{ background: "var(--fill-secondary)" }}
      >
        {THEMES.map((t, i) => (
          <button
            key={t}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
            style={{
              borderTop: i === 0 ? undefined : "1px solid var(--fill-divider)",
            }}
            onClick={() => actions.setTheme(t)}
          >
            <span
              className="text-[14px]"
              style={{ color: "var(--text-primary)" }}
            >
              {themeName[t]}
            </span>
            {theme === t && (
              <Check size={18} style={{ color: "var(--text-primary)" }} />
            )}
          </button>
        ))}
      </div>
      {server && <PinSecurity />}
    </div>
  );
}

/* ---------------- Shell ---------------- */

export function SettingsModal({
  ui,
  theme,
  session,
  demo,
  actions,
}: {
  ui: Ui["settings"];
  theme: Theme;
  /** the server, for the parts of settings that are its (connectors) */
  session: Session;
  /** the in-browser demo, which can be started over */
  demo: boolean;
  actions: Actions;
}) {
  const { mounted, closing, onAnimationEnd } = usePresence(ui.open);
  // adding (a website rule, a login) starts from the bar's +, and ends with the section
  const [adding, setAdding] = useState(false);
  const { backend, loading: backendLoading, unavailable: backendUnavailable } = useBackendStatus(session, ui.open && !demo);
  useEffect(() => setAdding(false), [ui.section, ui.open]);
  if (!mounted) return null;
  // a phone shows the sections as a list first, then one section as a page of its own; a desktop shows both side by side
  const section = ui.section;
  const shown = section ?? "general";
  const paseo = backend?.kind === "paseo";
  const viewingProvider = paseo ? null : ui.provider;
  const nav = NAV.map((item) => item.id === "models" && paseo ? { ...item, label: "Backend" } : item);
  const round = "flex size-8 shrink-0 items-center justify-center rounded-full";
  // the page's bar: what it is, and its one action (adding, where there is something to add)
  const title = !section
    ? "Settings"
    : ui.app
      ? ui.app.name
      : viewingProvider
        ? viewingProvider.name
        : (nav.find((n) => n.id === section)?.label ?? "");
  const adds = !paseo && !backendLoading && !ui.app && shown === "permissions" ? "Add a website" : null;
  // a phone's bar has the chat's round buttons; a desktop's has small labelled ones, the height of its close button
  const add = adds && (
    <button
      aria-label={adds}
      aria-pressed={adding}
      className={barButton}
      style={barButtonLook}
      onClick={() => setAdding((a) => !a)}
    >
      <Plus size={barIcon} />
    </button>
  );
  const addLabelled = adds && (
    <button
      aria-pressed={adding}
      className="hover-fade flex h-8 shrink-0 items-center gap-1.5 rounded-full pl-2.5 pr-3.5 text-[14px] font-medium"
      style={{
        background: "var(--fill-secondary)",
        color: "var(--text-primary)",
      }}
      onClick={() => setAdding((a) => !a)}
    >
      <Plus size={15} /> {adds}
    </button>
  );
  return (
    <div
      className={`fixed inset-0 z-[80] flex justify-center sm:items-center sm:p-4 ${closing ? "pointer-events-none" : ""}`}
    >
      <div
        className={`${closing ? "anim-fade-out" : "anim-fade-in"} absolute inset-0 hidden bg-black/30 sm:block`}
        onClick={() => actions.closeSettings()}
      />
      <div
        onAnimationEnd={onAnimationEnd}
        className={`${closing ? "anim-settings-out" : "anim-settings-in"} relative flex h-full w-full flex-col overflow-hidden sm:h-[72vh] sm:max-h-[620px] sm:max-w-3xl sm:flex-row sm:rounded-[28px]`}
        style={{
          background: "var(--chat-background)",
          boxShadow: "var(--shadow-sheet)",
        }}
      >
        {/* phone: the page's bar, as over the chat — back one level (or out), the page's name, and its action */}
        <header className="grid shrink-0 grid-cols-[44px_1fr_44px] items-center gap-2 px-3 py-2 sm:hidden">
          <button
            aria-label={
              !section
                ? "Close settings"
                : ui.app
                  ? "All connectors"
                  : viewingProvider
                    ? "All providers"
                    : "All settings"
            }
            className={barButton}
            style={barButtonLook}
            onClick={() =>
              !section
                ? actions.closeSettings()
                : ui.app
                  ? actions.openApp(null)
                  : viewingProvider
                    ? actions.openProvider(null)
                    : actions.openSettings(null)
            }
          >
            <ChevronLeft size={barIcon} />
          </button>
          <p
            className="truncate text-center text-[17px] font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {title}
          </p>
          {add ?? <span />}
        </header>

        {/* the sections: a list on a phone (until one is open), a column on a desktop */}
        <nav
          className={`${section ? "hidden sm:flex" : "flex"} shrink-0 flex-col gap-1 px-3 sm:w-[220px] sm:border-r sm:p-4`}
          style={{ borderColor: "var(--fill-divider)" }}
        >
          <p
            className="hidden px-2 pb-2 text-[19px] font-semibold sm:block"
            style={{ color: "var(--text-primary)" }}
          >
            Settings
          </p>
          {nav.map((n) => (
            <button
              key={n.id}
              className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-[16px] font-medium sm:py-2.5 sm:text-[15px]"
              style={{
                background:
                  shown === n.id && section
                    ? "var(--fill-secondary)"
                    : "transparent",
                color: "var(--text-primary)",
              }}
              onClick={() => actions.openSettings(n.id)}
            >
              {n.icon}
              <span className="flex-1">{n.label}</span>
              <ChevronRight
                size={16}
                className="sm:hidden"
                style={{ color: "var(--icon-secondary)" }}
              />
            </button>
          ))}
          {demo && (
            <button
              className="mt-auto hidden items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium sm:flex"
              style={{ color: "var(--text-secondary)" }}
              onClick={() => actions.reset()}
            >
              Reset demo
            </button>
          )}
        </nav>

        {/* the section */}
        <div
          className={`${section ? "flex" : "hidden sm:flex"} relative min-h-0 min-w-0 flex-1 flex-col`}
        >
          {/* desktop: the section's bar — its name, its action, and close */}
          <header className="hidden h-16 shrink-0 items-center gap-2 pl-6 pr-4 sm:flex">
            <p
              className="flex-1 truncate text-[20px] font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {ui.app || viewingProvider ? "" : title}
            </p>
            {addLabelled}
            <button
              aria-label="Close settings"
              className={round}
              style={{
                background: "var(--fill-secondary)",
                color: "var(--icon-primary)",
              }}
              onClick={() => actions.closeSettings()}
            >
              <X size={17} />
            </button>
          </header>
          {shown === "connectors" && (
            <>
              {paseo && <p className="mx-5 mb-4 shrink-0 rounded-xl px-4 py-3 text-[13px] leading-relaxed sm:mx-6"
                style={{ background: "var(--fill-secondary)", color: "var(--text-secondary)" }}>
                此处管理 Amuse 独立的应用连接，不会自动导入 Codex 工具。
              </p>}
              <AppsKey
                session={session}
                demo={demo}
                viewing={ui.app}
                onView={actions.openApp}
              />
            </>
          )}
          {shown === "permissions" && paseo && (
            <div className="flex-1 overflow-y-auto px-5 pb-6 sm:px-6">
              <div className="rounded-[18px] p-4" style={{ background: "var(--fill-secondary)" }}>
                <p className="flex items-center gap-2 text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>
                  <Shield size={18} /> Paseo / Codex
                </p>
                <p className="mt-3 text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  执行权限沿用电脑 Paseo 的 Codex 配置。当前 Amuse 站点规则不控制该后端。
                </p>
              </div>
            </div>
          )}
          {shown === "permissions" && !paseo && backendLoading && (
            <div className="px-5 sm:px-6"><BackendStatus backend={null} loading /></div>
          )}
          {shown === "permissions" && !paseo && !backendLoading && (
            <SitePermissions
              session={session}
              adding={adding}
              onAdded={() => setAdding(false)}
            />
          )}
          {shown === "schedules" && <Schedules session={session} />}
          {shown === "models" && paseo && (
            <div className="flex-1 overflow-y-auto px-5 pb-6 sm:px-6">
              <BackendStatus backend={backend} unavailable={backendUnavailable} />
              <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                Chats use the Paseo session on your computer. The model, sign-in and tool permissions follow that session’s configuration. Change them on your computer; this app reuses the same configuration.
              </p>
            </div>
          )}
          {shown === "models" && !paseo && backendLoading && (
            <div className="px-5 sm:px-6"><BackendStatus backend={null} loading /></div>
          )}
          {shown === "models" && !paseo && !backendLoading && (
            <Models
              session={session}
              viewing={viewingProvider}
              onView={actions.openProvider}
            />
          )}
          {shown === "general" && (
            <GeneralSection theme={theme} server={!demo} actions={actions} backend={backend} backendLoading={backendLoading} backendUnavailable={backendUnavailable} />
          )}
        </div>
      </div>
    </div>
  );
}
