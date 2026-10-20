/**
 * Settings modal (surfaces 7, 8, 9, 10): left nav + section pane — General,
 * Connectors (the server's app directory: Connectors.tsx), Permissions (global
 * defaults + per-site Allow/Ask/Deny) and Secure store (credential list +
 * add-credential form). Modeled on the reference settings sheet.
 */
import { useState } from "react";
import {
  ChevronRight,
  Check,
  Globe,
  LayoutGrid,
  Lock,
  Plus,
  Settings as SettingsIcon,
  Shield,
  X,
} from "lucide-react";
import type { SettingsData } from "../demo/settings.ts";
import type { Session } from "@remuse/protocol";
import type { Actions, SettingsSection, Theme, Ui } from "../ui.ts";
import { usePresence } from "./usePresence";
import { Connectors } from "./Connectors";
import { SitePermissions } from "./SitePermissions";


const NAV: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <SettingsIcon size={18} /> },
  { id: "connectors", label: "Connectors", icon: <LayoutGrid size={18} /> },
  { id: "permissions", label: "Permissions", icon: <Shield size={18} /> },
  { id: "secure-store", label: "Secure store", icon: <Lock size={18} /> },
];

/* ---------------- Secure store ---------------- */

function SecureStoreSection({ data, actions }: { data: SettingsData; actions: Actions }) {
  const [adding, setAdding] = useState(false);
  const [domain, setDomain] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = () => {
    if (!domain.trim()) return;
    actions.addCredential(domain.trim(), username.trim() || "—");
    setDomain("");
    setUsername("");
    setPassword("");
    setAdding(false);
  };

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="flex items-start justify-between gap-4 pr-10">
        <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>
          Securely store passwords for your agent to use.
        </p>
        <button
          className="flex h-9 shrink-0 items-center gap-1 rounded-full px-4 text-[14px] font-semibold text-white"
          style={{ background: "var(--fill-blue)" }}
          onClick={() => setAdding((a) => !a)}
        >
          <Plus size={15} /> Add
        </button>
      </div>

      {adding && (
        <div className="mt-4 space-y-2.5 rounded-xl p-4" style={{ background: "var(--fill-secondary)" }}>
          {[
            { label: "Website / domain", value: domain, set: setDomain, type: "text" },
            { label: "Username", value: username, set: setUsername, type: "text" },
            { label: "Password", value: password, set: setPassword, type: "password" },
          ].map((f) => (
            <label key={f.label} className="block">
              <span className="mb-1 block text-[12px]" style={{ color: "var(--text-secondary)" }}>
                {f.label}
              </span>
              <input
                type={f.type}
                className="w-full rounded-[10px] border-0 px-3 py-2 text-[14px] outline-none"
                style={{ background: "var(--fill-primary)", color: "var(--text-primary)" }}
                value={f.value}
                onChange={(e) => f.set(e.target.value)}
              />
            </label>
          ))}
          <button
            className="h-9 w-full rounded-full text-[14px] font-semibold text-white"
            style={{ background: "var(--fill-blue)" }}
            onClick={submit}
          >
            Save credential
          </button>
        </div>
      )}

      <p className="mb-2 mt-5 text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
        Passwords
      </p>
      <div className="overflow-hidden rounded-xl" style={{ background: "var(--fill-secondary)" }}>
        {data.credentials.length === 0 && (
          <p className="px-4 py-3 text-[14px]" style={{ color: "var(--text-secondary)" }}>
            No credentials stored yet.
          </p>
        )}
        {data.credentials.map((c, i) => (
          <div
            key={c.id}
            className="flex items-center gap-3 px-4 py-3"
            style={{ borderTop: i === 0 ? undefined : "1px solid var(--fill-divider)" }}
          >
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-[9px]"
              style={{ background: "var(--fill-primary)", color: "var(--icon-primary)" }}
            >
              <Lock size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
                {c.domain}
              </span>
              <span className="block truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>
                {c.username}
              </span>
            </span>
            <ChevronRight size={15} style={{ color: "var(--icon-secondary)" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- General ---------------- */

function GeneralSection({ theme, actions }: { theme: Theme; actions: Actions }) {
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <p className="mb-2 text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
        Appearance
      </p>
      <div className="overflow-hidden rounded-xl" style={{ background: "var(--fill-secondary)" }}>
        {(["light", "dark"] as const).map((t, i) => (
          <button
            key={t}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
            style={{ borderTop: i === 0 ? undefined : "1px solid var(--fill-divider)" }}
            onClick={() => actions.setTheme(t)}
          >
            <span className="text-[14px] capitalize" style={{ color: "var(--text-primary)" }}>
              {t}
            </span>
            {theme === t && <Check size={18} style={{ color: "var(--text-primary)" }} />}
          </button>
        ))}
      </div>
      <p className="mt-4 text-[13px]" style={{ color: "var(--text-secondary)" }}>
        remuse is running on a local demo session.
      </p>
    </div>
  );
}

/* ---------------- Shell ---------------- */

export function SettingsModal({
  ui,
  theme,
  data,
  session,
  actions,
}: {
  ui: Ui["settings"];
  theme: Theme;
  data: SettingsData;
  /** the server, for the parts of settings that are its (connectors) */
  session: Session;
  actions: Actions;
}) {
  const { mounted, closing, onAnimationEnd } = usePresence(ui.open);
  if (!mounted) return null;
  return (
    <div className={`fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4 ${closing ? "pointer-events-none" : ""}`}>
      <div
        className={`${closing ? "anim-fade-out" : "anim-fade-in"} absolute inset-0 bg-black/30`}
        onClick={() => actions.closeSettings()}
      />
      <div
        onAnimationEnd={onAnimationEnd}
        className={`${closing ? "anim-modal-out" : "anim-modal-in"} relative flex h-[72vh] max-h-[620px] w-full max-w-3xl flex-col overflow-hidden rounded-t-[28px] sm:flex-row sm:rounded-[28px]`}
        style={{ background: "var(--chat-background)", boxShadow: "var(--shadow-sheet)" }}
      >
        {/* left nav — horizontal icon row on mobile, column on sm+ */}
        <nav
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-b p-2 sm:w-[220px] sm:flex-col sm:items-stretch sm:border-b-0 sm:border-r sm:p-4"
          style={{ borderColor: "var(--fill-divider)" }}
        >
          <p className="hidden px-2 pb-2 text-[19px] font-semibold sm:block" style={{ color: "var(--text-primary)" }}>
            Settings
          </p>
          {NAV.map((n) => (
            <button
              key={n.id}
              className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-left text-[14px] font-medium sm:gap-3 sm:py-2.5 sm:text-[15px]"
              style={{
                background: ui.section === n.id ? "var(--fill-secondary)" : "transparent",
                color: "var(--text-primary)",
              }}
              onClick={() => {
                actions.openSettings(n.id);
              }}
            >
              {n.icon}
              {n.label}
            </button>
          ))}
          <button
            className="mt-auto hidden items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium sm:flex"
            style={{ color: "var(--text-secondary)" }}
            onClick={() => actions.reset()}
          >
            Reset demo
          </button>
        </nav>

        {/* right pane */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <button
            aria-label="Close settings"
            className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full"
            style={{ background: "var(--fill-secondary)", color: "var(--icon-primary)" }}
            onClick={() => actions.closeSettings()}
          >
            <X size={17} />
          </button>
          {ui.section === "connectors" && <Connectors session={session} />}
          {ui.section === "permissions" && <SitePermissions session={session} />}
          {ui.section === "secure-store" && <SecureStoreSection data={data} actions={actions} />}
          {ui.section === "general" && <GeneralSection theme={theme} actions={actions} />}
        </div>
      </div>
    </div>
  );
}

