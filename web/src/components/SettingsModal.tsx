/**
 * Settings (surfaces 7, 9, 10): a page on a phone, a modal with a nav column on
 * a desktop — General (appearance; the password), Models (the user's keys and
 * the models chosen: Models.tsx), Connectors (the server's app directory: Connectors.tsx),
 * Permissions (per-site Allow/Ask/Deny), Schedules and the Sandbox (reset it). Modeled on the reference
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
  KeyRound,
  Terminal,
  X,
  CalendarClock,
} from "lucide-react";
import type { Session } from "@amuse/protocol";
import type { Actions, SettingsSection, Theme, Ui } from "../ui.ts";
import { THEMES } from "../theme.ts";
import { usePresence } from "./usePresence";
import { barButton, barButtonLook, barIcon } from "./bar";
import { AppsKey } from "./AppsKey";
import { SitePermissions } from "./SitePermissions";
import { Schedules } from "./Schedules";
import { Models } from "./Models";
import { Logins } from "./Logins";
import { Sandbox } from "./Sandbox";
import { changePassword, lock } from "../connection.ts";

const NAV: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <SettingsIcon size={18} /> },
  { id: "models", label: "Models", icon: <Sparkles size={18} /> },
  { id: "connectors", label: "Connectors", icon: <LayoutGrid size={18} /> },
  { id: "permissions", label: "Permissions", icon: <Shield size={18} /> },
  { id: "logins", label: "Saved logins", icon: <KeyRound size={18} /> },
  { id: "schedules", label: "Schedules", icon: <CalendarClock size={18} /> },
  { id: "sandbox", label: "Sandbox", icon: <Terminal size={18} /> },
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
}: {
  theme: Theme;
  /** there is a server, with a password (not the in-browser demo) */
  server: boolean;
  actions: Actions;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-5">
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
      {server && <PasswordGroup />}
    </div>
  );
}

/** The master password: change it (every other device then needs the new one), or lock this device. */
function PasswordGroup() {
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const field = "w-full bg-transparent px-4 py-3 text-[14px] outline-none";
  const row =
    "flex w-full items-center justify-between px-4 py-3 text-left text-[14px]";
  return (
    <>
      <p
        className="mb-2 mt-6 text-[15px] font-semibold"
        style={{ color: "var(--text-primary)" }}
      >
        Password
      </p>
      <div
        className="overflow-hidden rounded-xl"
        style={{ background: "var(--fill-secondary)" }}
      >
        {changing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!current || !next) return;
              void changePassword(current, next).then((why) => {
                setSaid(
                  why
                    ? { ok: false, text: why }
                    : {
                        ok: true,
                        text: "Changed. Other devices need the new password.",
                      },
                );
                if (!why) {
                  setChanging(false);
                  setCurrent("");
                  setNext("");
                }
              });
            }}
          >
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              aria-label="Current password"
              placeholder="Current password"
              className={field}
              style={{ color: "var(--text-primary)" }}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <input
              type="password"
              autoComplete="new-password"
              aria-label="New password"
              placeholder="New password"
              className={field}
              style={{
                color: "var(--text-primary)",
                borderTop: "1px solid var(--fill-divider)",
              }}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <div
              className="flex justify-end gap-2 px-3 py-2"
              style={{ borderTop: "1px solid var(--fill-divider)" }}
            >
              <button
                type="button"
                className="hover-fade h-9 rounded-full px-3 text-[14px] font-medium"
                style={{ color: "var(--text-primary)" }}
                onClick={() => setChanging(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!current || !next}
                className="h-9 rounded-full px-4 text-[14px] font-semibold text-white disabled:opacity-40"
                style={{ background: "var(--fill-blue)" }}
              >
                Change
              </button>
            </div>
          </form>
        ) : (
          <button
            className={row}
            style={{ color: "var(--text-primary)" }}
            onClick={() => {
              setSaid(null);
              setChanging(true);
            }}
          >
            Change password
          </button>
        )}
        <button
          className={row}
          style={{
            color: "var(--fill-red)",
            borderTop: "1px solid var(--fill-divider)",
          }}
          onClick={() => void lock()}
        >
          Lock this device
        </button>
      </div>
      {said && (
        <p
          role={said.ok ? "status" : "alert"}
          className="mt-2 px-1 text-[13px]"
          style={{
            color: said.ok ? "var(--text-secondary)" : "var(--fill-red)",
          }}
        >
          {said.text}
        </p>
      )}
    </>
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
  useEffect(() => setAdding(false), [ui.section, ui.open]);
  if (!mounted) return null;
  // a phone shows the sections as a list first, then one section as a page of its own; a desktop shows both side by side
  const section = ui.section;
  const shown = section ?? "general";
  const round = "flex size-8 shrink-0 items-center justify-center rounded-full";
  // the page's bar: what it is, and its one action (adding, where there is something to add)
  const title = !section
    ? "Settings"
    : ui.app
      ? ui.app.name
      : ui.provider
        ? ui.provider.name
        : (NAV.find((n) => n.id === section)?.label ?? "");
  const adds = !ui.app && shown === "permissions" ? "Add a website" : null;
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
                  : ui.provider
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
                  : ui.provider
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
          {NAV.filter((n) => !demo || n.id !== "sandbox").map((n) => (
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
              {/* the section shown (General before one is chosen), not the phone's list title */}
              {ui.app || ui.provider ? "" : (NAV.find((n) => n.id === shown)?.label ?? "")}
            </p>
            {addLabelled}
            <button
              aria-label="Close settings"
              className={barButton}
              style={barButtonLook}
              onClick={() => actions.closeSettings()}
            >
              <X size={barIcon} />
            </button>
          </header>
          {shown === "connectors" && (
            <AppsKey
              session={session}
              demo={demo}
              viewing={ui.app}
              onView={actions.openApp}
            />
          )}
          {shown === "permissions" && (
            <SitePermissions
              session={session}
              adding={adding}
              onAdded={() => setAdding(false)}
            />
          )}
          {shown === "schedules" && <Schedules session={session} />}
          {shown === "logins" && <Logins session={session} />}
          {shown === "sandbox" && <Sandbox session={session} />}
          {shown === "models" && (
            <Models
              session={session}
              viewing={ui.provider}
              onView={actions.openProvider}
            />
          )}
          {shown === "general" && (
            <GeneralSection theme={theme} server={!demo} actions={actions} />
          )}
        </div>
      </div>
    </div>
  );
}
