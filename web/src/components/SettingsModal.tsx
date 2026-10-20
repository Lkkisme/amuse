/**
 * Settings modal (surfaces 7, 8, 9, 10): left nav + section pane — General,
 * Connectors (with per-connector capability groups), Permissions (global
 * defaults + per-site Allow/Ask/Deny) and Secure store (credential list +
 * add-credential form). Modeled on the reference settings sheet.
 */
import { useState } from "react";
import {
  ArrowLeft,
  Calendar,
  ChevronRight,
  FileText,
  GitBranch,
  Check,
  Globe,
  Lock,
  Mail,
  Plus,
  Search,
  Settings as SettingsIcon,
  Shield,
  Table,
  X,
} from "lucide-react";
import type { DemoState, Level } from "../data/fakeMuse";
import { LEVELS, levelMeta, parseLevel } from "../data/fakeMuse";
import type { MuseActions, SettingsSection } from "./actions";
import { usePresence } from "./usePresence";

function ConnectorIcon({ id, size = 20 }: { id: string; size?: number }) {
  const map: Record<string, React.ReactNode> = {
    gmail: <Mail size={size} />,
    gcal: <Calendar size={size} />,
    gdrive: <FileText size={size} />,
    sheets: <Table size={size} />,
    github: <GitBranch size={size} />,
  };
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[10px] text-white"
      style={{ width: size + 16, height: size + 16, background: "var(--fill-blue)" }}
    >
      {map[id] ?? <Globe size={size} />}
    </span>
  );
}

function LevelSelect({ value, onChange }: { value: Level; onChange: (l: Level) => void }) {
  return (
    <select
      className="cursor-pointer appearance-none rounded-full border-0 bg-transparent py-1 pl-3 pr-6 text-[13px] font-medium outline-none"
      style={{
        background: "var(--fill-primary)",
        color: value === "deny" ? "var(--fill-red)" : value === "ask" ? "var(--fill-orange)" : "var(--text-primary)",
      }}
      value={value}
      onChange={(e) => {
        const level = parseLevel(e.target.value);
        if (level) onChange(level);
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {LEVELS.map((l) => (
        <option key={l} value={l}>
          {levelMeta[l]}
        </option>
      ))}
    </select>
  );
}

const NAV: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <SettingsIcon size={18} /> },
  { id: "connectors", label: "Connectors", icon: <Table size={18} /> },
  { id: "permissions", label: "Permissions", icon: <Shield size={18} /> },
  { id: "secure-store", label: "Secure store", icon: <Lock size={18} /> },
];

/* ---------------- Connectors ---------------- */

function ConnectorsSection({ state, actions }: { state: DemoState; actions: MuseActions }) {
  const detail = state.connectorDetail
    ? state.connectors.find((c) => c.id === state.connectorDetail) ?? null
    : null;

  if (detail) {
    const groups = [...new Set(detail.capabilities.map((c) => c.group))];
    return (
      <div className="flex-1 overflow-y-auto p-5">
        <button
          className="mb-2 flex size-9 items-center justify-center rounded-full"
          style={{ color: "var(--icon-primary)", background: "var(--fill-secondary)" }}
          onClick={() => actions.openConnectorDetail(null)}
          aria-label="Back to connectors"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="mt-2 flex flex-col items-center gap-1">
          <ConnectorIcon id={detail.id} size={28} />
          <p className="text-[19px] font-semibold" style={{ color: "var(--text-primary)" }}>
            {detail.name}
          </p>
          <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
            You can give read-only or read and write access
          </p>
        </div>

        {detail.connected && (
          <button
            className="mt-4 h-11 w-full rounded-xl text-[15px] font-semibold"
            style={{ background: "var(--fill-secondary)", color: "var(--fill-red)" }}
            onClick={() => actions.toggleConnector(detail.id)}
          >
            Disconnect
          </button>
        )}
        {!detail.connected && (
          <button
            className="mt-4 h-11 w-full rounded-xl text-[15px] font-semibold text-white"
            style={{ background: "var(--fill-blue)" }}
            onClick={() => actions.toggleConnector(detail.id)}
          >
            Connect {detail.name}
          </button>
        )}

        {groups.map((g) => (
          <div key={g} className="mt-5">
            <p className="mb-2 text-[13px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              {g}
            </p>
            <div className="overflow-hidden rounded-xl" style={{ background: "var(--fill-secondary)" }}>
              {detail.capabilities
                .filter((c) => c.group === g)
                .map((cap, i, arr) => (
                  <div
                    key={cap.id}
                    className="flex items-center justify-between px-4 py-3"
                    style={{ borderTop: i === 0 ? undefined : "1px solid var(--fill-divider)" }}
                  >
                    <span className="text-[14px]" style={{ color: "var(--text-primary)" }}>
                      {cap.label}
                    </span>
                    <LevelSelect value={cap.level} onChange={(l) => actions.setCapabilityLevel(detail.id, cap.id, l)} />
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const connected = state.connectors.filter((c) => c.connected);
  const available = state.connectors.filter((c) => !c.connected);
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div
        className="flex h-10 items-center gap-2 rounded-full px-3"
        style={{ background: "var(--fill-secondary)", color: "var(--text-tertiary)" }}
      >
        <Search size={16} />
        <input
          className="w-full bg-transparent text-[14px] outline-none"
          style={{ color: "var(--text-primary)" }}
          placeholder="Search"
        />
      </div>

      {(["Connected", "Available"] as const).map((label) => {
        const list = label === "Connected" ? connected : available;
        if (list.length === 0) return null;
        return (
          <div key={label} className="mt-5">
            <p className="mb-2 text-[13px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              {label}
            </p>
            <div className="overflow-hidden rounded-xl" style={{ background: "var(--fill-secondary)" }}>
              {list.map((c, i) => (
                <button
                  key={c.id}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  style={{ borderTop: i === 0 ? undefined : "1px solid var(--fill-divider)" }}
                  onClick={() => actions.openConnectorDetail(c.id)}
                >
                  <ConnectorIcon id={c.id} size={18} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>
                      {c.name}
                    </span>
                    <span className="block truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>
                      {c.blurb}
                    </span>
                  </span>
                  <span className="text-[13px] font-semibold" style={{ color: "var(--fill-blue)" }}>
                    View
                  </span>
                  <ChevronRight size={14} style={{ color: "var(--icon-secondary)" }} />
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Permissions ---------------- */

function DefaultsCard({ title, options }: { title: string; options: { label: string; sub: string }[] }) {
  const [selected, setSelected] = useState(0);
  return (
    <div className="mt-5">
      <p className="mb-2 text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </p>
      <div className="overflow-hidden rounded-xl" style={{ background: "var(--fill-secondary)" }}>
        {options.map((o, i) => (
          <button
            key={o.label}
            className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
            style={{ borderTop: i === 0 ? undefined : "1px solid var(--fill-divider)" }}
            onClick={() => setSelected(i)}
          >
            <span>
              <span className="block text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
                {o.label}
              </span>
              <span className="block text-[12px]" style={{ color: "var(--text-secondary)" }}>
                {o.sub}
              </span>
            </span>
            {selected === i && <Check size={18} style={{ color: "var(--text-primary)" }} className="mt-1 shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function PermissionsSection({ state, actions }: { state: DemoState; actions: MuseActions }) {
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <DefaultsCard
        title="Connector defaults"
        options={[
          { label: "Ask for some actions", sub: "Before actions that may share your information or make important changes" },
          { label: "Always ask", sub: "Before any action" },
        ]}
      />
      <DefaultsCard
        title="Web access defaults"
        options={[
          { label: "Ask for some actions", sub: "When your information may be shared or the website is unfamiliar" },
          { label: "Always ask", sub: "Ask before accessing any website" },
        ]}
      />

      <p className="mb-2 mt-6 text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
        Websites
      </p>
      <div className="overflow-hidden rounded-xl" style={{ background: "var(--fill-secondary)" }}>
        {state.websiteRules.map((r, i) => (
          <div
            key={r.id}
            className="flex items-center justify-between px-4 py-3"
            style={{ borderTop: i === 0 ? undefined : "1px solid var(--fill-divider)" }}
          >
            <span className="flex items-center gap-2.5 text-[14px]" style={{ color: "var(--text-primary)" }}>
              <Globe size={16} style={{ color: "var(--icon-secondary)" }} />
              {r.site}
            </span>
            <LevelSelect value={r.level} onChange={(l) => actions.setWebsiteRuleLevel(r.id, l)} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Secure store ---------------- */

function SecureStoreSection({ state, actions }: { state: DemoState; actions: MuseActions }) {
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
        {state.credentials.length === 0 && (
          <p className="px-4 py-3 text-[14px]" style={{ color: "var(--text-secondary)" }}>
            No credentials stored yet.
          </p>
        )}
        {state.credentials.map((c, i) => (
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

function GeneralSection({ state, actions }: { state: DemoState; actions: MuseActions }) {
  const dark = typeof window !== "undefined" && document.documentElement.classList.contains("dark");
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
            {(dark === (t === "dark")) && <Check size={18} style={{ color: "var(--text-primary)" }} />}
          </button>
        ))}
      </div>
      <p className="mt-4 text-[13px]" style={{ color: "var(--text-secondary)" }}>
        remuse is a study replica. No account, no network — everything here is fake state.
      </p>
    </div>
  );
}

/* ---------------- Shell ---------------- */

export function SettingsModal({ state, actions }: { state: DemoState; actions: MuseActions }) {
  const { mounted, closing, onAnimationEnd } = usePresence(state.settingsOpen);
  if (!mounted) return null;
  return (
    <div className={`fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-4 ${closing ? "pointer-events-none" : ""}`}>
      <div
        className={`${closing ? "anim-fade-out" : "anim-fade-in"} absolute inset-0 bg-black/30`}
        onClick={() => actions.closeSettings()}
      />
      <div
        onAnimationEnd={onAnimationEnd}
        className={`${closing ? "anim-modal-out" : "anim-modal-in"} relative flex h-[72vh] max-h-[620px] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl sm:flex-row sm:rounded-2xl`}
        style={{ background: "var(--chat-background)", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}
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
                background: state.settingsSection === n.id ? "var(--fill-secondary)" : "transparent",
                color: "var(--text-primary)",
              }}
              onClick={() => {
                actions.openSettings(n.id);
                actions.openConnectorDetail(null);
              }}
            >
              {n.icon}
              {n.label}
            </button>
          ))}
          <button
            className="mt-auto hidden items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium sm:flex"
            style={{ color: "var(--text-secondary)" }}
            onClick={() => actions.resetDemo()}
          >
            Reset demo
          </button>
        </nav>

        {/* right pane */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <button
            aria-label="Close settings"
            className="absolute right-4 top-4 z-10 flex size-8 items-center justify-center rounded-full"
            style={{ background: "var(--fill-secondary)", color: "var(--icon-primary)" }}
            onClick={() => actions.closeSettings()}
          >
            <X size={17} />
          </button>
          {state.settingsSection === "connectors" && <ConnectorsSection state={state} actions={actions} />}
          {state.settingsSection === "permissions" && <PermissionsSection state={state} actions={actions} />}
          {state.settingsSection === "secure-store" && <SecureStoreSection state={state} actions={actions} />}
          {state.settingsSection === "general" && <GeneralSection state={state} actions={actions} />}
        </div>
      </div>
    </div>
  );
}

