/**
 * Settings (surfaces 7, 9, 10): a page on a phone, a modal with a nav column on
 * a desktop — General (appearance, language), Security (the PIN, the password,
 * the devices: Security.tsx), Models (the user's keys and
 * the models chosen: Models.tsx), Connections (the server's directory: Connectors.tsx),
 * Permissions (per-site Allow/Ask/Deny), the Vault (SecretStore.tsx), Browser data (the sites the browser keeps
 * the user signed in to), Schedules and the Sandbox (reset it). Modeled on the reference settings sheet.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Globe,
  LayoutGrid,
  Plus,
  Cookie,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  LockKeyhole,
  Terminal,
  Vault,
  X,
  CalendarClock,
} from "lucide-react";
import type { BackendStatus as Backend, Session } from "@amuse/protocol";
import type { Actions, SettingsSection, Theme, Ui } from "../ui.ts";
import type { Choice } from "../i18n/language.ts";
import { useLanguageChoice, useT } from "../i18n/react.ts";
import type { Messages } from "../i18n/en.ts";
import { Button } from "./Button";
import { usePresence } from "./usePresence";
import { barButton, barButtonLook, barIcon } from "./bar";
import { AppsKey } from "./AppsKey";
import { SitePermissions } from "./SitePermissions";
import { Schedules } from "./Schedules";
import { Models } from "./Models";
import { BackendStatus, useBackendStatus } from "./BackendStatus";
import { Logins } from "./Logins";
import { Sandbox } from "./Sandbox";
import { SecretStore } from "./SecretStore";
import { type BarSlots, BarSlotsContext } from "./SecretFields";
import { computerName } from "../secrets.ts";
import { Security } from "./Security";

const NAV: { id: SettingsSection; icon: React.ReactNode }[] = [
  { id: "general", icon: <SettingsIcon size={18} /> },
  { id: "security", icon: <LockKeyhole size={18} /> },
  { id: "models", icon: <Sparkles size={18} /> },
  { id: "connectors", icon: <LayoutGrid size={18} /> },
  { id: "permissions", icon: <Shield size={18} /> },
  { id: "secrets", icon: <Vault size={18} /> },
  { id: "logins", icon: <Cookie size={18} /> },
  { id: "schedules", icon: <CalendarClock size={18} /> },
  { id: "sandbox", icon: <Terminal size={18} /> },
];

/* ---------------- General ---------------- */

function GeneralSection({
  theme,
  actions,
  backend,
  backendLoading,
  backendUnavailable,
}: {
  theme: Theme;
  actions: Actions;
  backend: Backend | null;
  backendLoading: boolean;
  backendUnavailable: boolean;
}) {
  const t = useT();
  const [language, setLanguage] = useLanguageChoice();
  const themes: { value: Theme; label: string }[] = [
    { value: "system", label: t.settings.general.matchSystem },
    { value: "light", label: t.settings.general.light },
    { value: "dark", label: t.settings.general.dark },
  ];
  const languages = [
    { value: "system", label: t.settings.general.languageSystem },
    { value: "en", label: "English" },
    { value: "zh-CN", label: "简体中文" },
  ] satisfies { value: Choice; label: string }[];
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <BackendStatus backend={backend} loading={backendLoading} unavailable={backendUnavailable} />
      <p
        className="mb-2 text-[15px] font-semibold"
        style={{ color: "var(--text-primary)" }}
      >
        {t.settings.general.appearance}
      </p>
      <OptionList options={themes} value={theme} onPick={actions.setTheme} />
      <p
        className="mb-2 mt-6 text-[15px] font-semibold"
        style={{ color: "var(--text-primary)" }}
      >
        {t.settings.general.language}
      </p>
      <OptionList
        options={languages}
        value={language}
        onPick={setLanguage}
      />
    </div>
  );
}

/** A group of rows, one chosen: each row picks its value. */
function OptionList<T extends string>({
  options,
  value,
  onPick,
}: {
  options: { value: T; label: string }[];
  value: T;
  onPick: (value: T) => void;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{ background: "var(--fill-secondary)" }}
    >
      {options.map((option, i) => (
        <button
          key={option.value}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
          style={{
            borderTop: i === 0 ? undefined : "1px solid var(--fill-divider)",
          }}
          onClick={() => onPick(option.value)}
        >
          <span className="text-[14px]" style={{ color: "var(--text-primary)" }}>
            {option.label}
          </span>
          {value === option.value && (
            <Check size={18} style={{ color: "var(--text-primary)" }} />
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * A section's name where the page is shown: the Computer page is named in full here (「Amuse 的电脑」), since its
 * row in the nav is the short form (「电脑」).
 */
function sectionName(t: Messages, section: SettingsSection): string {
  return section === "sandbox" ? computerName(t) : t.settings.sections[section];
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
  const t = useT();
  const { mounted, closing, onAnimationEnd } = usePresence(ui.open);
  // adding (a website rule, a login) starts from the bar's +, and ends with the section
  const [adding, setAdding] = useState(false);
  const { backend, loading: backendLoading, unavailable: backendUnavailable } = useBackendStatus(session, ui.open && !demo);
  const paseo = backend?.kind === "paseo";
  const viewingProvider = paseo ? null : ui.provider;
  // the bar's room for a Vault page's button (SecretFields.tsx)
  const [slots, setSlots] = useState<BarSlots>({ phone: null, desktop: null });
  const phoneSlot = useCallback((el: HTMLElement | null) => setSlots((was) => (was.phone === el ? was : { ...was, phone: el })), []);
  const desktopSlot = useCallback((el: HTMLElement | null) => setSlots((was) => (was.desktop === el ? was : { ...was, desktop: el })), []);
  useEffect(() => setAdding(false), [ui.section, ui.open]);
  if (!mounted) return null;
  // a phone shows the sections as a list first, then one section as a page of its own; a desktop shows both side by side
  const section = ui.section;
  const shown = section ?? "general";
  const round = "flex size-8 shrink-0 items-center justify-center rounded-full";
  // the page's bar: what it is, and its one action (adding, where there is something to add)
  const title = !section
    ? t.settings.title
    : ui.app
      ? ui.app.name
      : viewingProvider
        ? viewingProvider.name
        : ui.entry
          ? ui.entry.kind === "add"
            ? t.secrets.newTitle
            : ui.entry.name
          : sectionName(t, section);
  const adds =
    !ui.app && shown === "permissions"
      ? t.settings.addWebsite
      : shown === "secrets" && !ui.entry
        ? t.secrets.add
        : null;
  // the Vault's adding is a page of its own (so Back leaves it); a website is added in place
  const onAdd = () => (shown === "secrets" ? actions.openEntry({ kind: "add" }) : setAdding((a) => !a));
  // a phone's bar has the chat's round buttons; a desktop's has small labelled ones, the height of its close button
  const add = adds && (
    <button
      aria-label={adds}
      aria-pressed={adding}
      className={barButton}
      style={barButtonLook}
      onClick={onAdd}
    >
      <Plus size={barIcon} />
    </button>
  );
  const addLabelled = adds && (
    <Button
      className="shrink-0"
      aria-pressed={adding}
      onClick={onAdd}
    >
      <Plus size={15} /> {adds}
    </Button>
  );
  return (
    // sm:h-[max(72vh,72%)]: the same height in a browser (72% of this full-height layer), and a real
    // height in the app's WebView, which reports 0 for the height viewport units.
    <div
      className={`fixed inset-0 z-[80] flex justify-center sm:items-center sm:p-4 ${closing ? "pointer-events-none" : ""}`}
    >
      <div
        className={`${closing ? "anim-fade-out" : "anim-fade-in"} absolute inset-0 hidden bg-black/30 sm:block`}
        onClick={() => actions.closeSettings()}
      />
      <div
        onAnimationEnd={onAnimationEnd}
        className={`${closing ? "anim-settings-out" : "anim-settings-in"} relative flex h-full w-full flex-col overflow-hidden sm:h-[max(72vh,72%)] sm:max-h-[620px] sm:max-w-3xl sm:flex-row sm:rounded-[28px]`}
        style={{
          background: "var(--chat-background)",
          boxShadow: "var(--shadow-sheet)",
        }}
      >
        {/* phone: the page's bar, as over the chat (its buttons 12px from the top and sides, where the chat's are) — back one level (or out), the page's name, and its action */}
        <header className="grid shrink-0 grid-cols-[44px_1fr_44px] items-center gap-2 px-3 pb-2 pt-3 sm:hidden">
          <button
            aria-label={
              !section
                ? t.settings.closeSettings
                : ui.app
                  ? t.settings.allConnections
                  : viewingProvider
                    ? t.settings.allProviders
                    : ui.entry
                      ? t.settings.allSecrets
                      : t.settings.allSettings
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
                    : ui.entry
                      ? actions.openEntry(null)
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
          {add ?? <span ref={phoneSlot} className="flex justify-end" />}
        </header>

        {/* the sections: a list on a phone (until one is open), a column on a desktop */}
        <nav
          className={`${section ? "hidden sm:flex" : "flex"} min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-3 sm:w-[220px] sm:flex-none sm:border-r sm:p-4`}
          style={{ borderColor: "var(--fill-divider)" }}
        >
          <p
            className="hidden shrink-0 px-2 pb-2 text-[19px] font-semibold sm:block"
            style={{ color: "var(--text-primary)" }}
          >
            {t.settings.title}
          </p>
          {NAV.filter((n) => !demo || (n.id !== "sandbox" && n.id !== "security")).map((n) => (
            <button
              key={n.id}
              className="flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-left text-[16px] font-medium sm:py-2.5 sm:text-[15px]"
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
              <span className="flex-1">{t.settings.sections[n.id]}</span>
              <ChevronRight
                size={16}
                className="sm:hidden"
                style={{ color: "var(--icon-secondary)" }}
              />
            </button>
          ))}
          {demo && (
            <button
              className="mt-auto hidden shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium sm:flex"
              style={{ color: "var(--text-secondary)" }}
              onClick={() => actions.reset()}
            >
              {t.settings.resetDemo}
            </button>
          )}
        </nav>

        {/* the section */}
        <div
          className={`${section ? "flex" : "hidden sm:flex"} relative min-h-0 min-w-0 flex-1 flex-col`}
        >
          {/* desktop: the section's bar — its name, its action, and close, 10px in from the card's top and right edges alike */}
          <header className="hidden h-16 shrink-0 items-center gap-2 pl-6 pr-2.5 sm:flex">
            <p
              className="flex-1 truncate text-[20px] font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {/* the section shown (General before one is chosen), not the phone's list title */}
              {ui.app || viewingProvider || ui.entry?.kind === "entry"
                ? ""
                : ui.entry
                  ? t.secrets.newTitle
                  : sectionName(t, shown)}
            </p>
            {addLabelled}
            <span ref={desktopSlot} className="flex" />
            <button
              aria-label={t.settings.closeSettings}
              className={barButton}
              style={barButtonLook}
              onClick={() => actions.closeSettings()}
            >
              <X size={barIcon} />
            </button>
          </header>
          {shown === "connectors" && (
            <div data-connections-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <AppsKey
                session={session}
                demo={demo}
                viewing={ui.app}
                onView={actions.openApp}
              />
            </div>
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
          {shown === "secrets" && (
            <BarSlotsContext.Provider value={slots}>
              <SecretStore session={session} page={ui.entry} onPage={actions.openEntry} />
            </BarSlotsContext.Provider>
          )}
          {shown === "sandbox" && (
            <Sandbox session={session} />
          )}
          {shown === "security" && !demo && <Security />}
          {shown === "models" && backendLoading && (
            <div className="px-5 sm:px-6"><BackendStatus backend={null} loading /></div>
          )}
          {shown === "models" && !backendLoading && (
            <Models
              session={session}
              executionManaged={paseo}
              header={paseo ? <>
                <BackendStatus backend={backend} unavailable={backendUnavailable} />
                <p className="mb-4 text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{t.backend.executionHelp}</p>
              </> : null}
              viewing={viewingProvider}
              onView={actions.openProvider}
            />
          )}
          {shown === "general" && (
            <GeneralSection theme={theme} actions={actions} backend={backend} backendLoading={backendLoading} backendUnavailable={backendUnavailable} />
          )}
        </div>
      </div>
    </div>
  );
}
