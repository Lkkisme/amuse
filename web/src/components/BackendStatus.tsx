import { useEffect, useState } from "react";
import { Check, Monitor, Unplug } from "lucide-react";
import type { BackendStatus as Status, Session } from "@amuse/protocol";
import { useT } from "../i18n/react.ts";

/** Older servers and the demo may not implement this optional settings read. */
export function useBackendStatus(session: Session, enabled: boolean) {
  const [state, setState] = useState<{ session: Session | null; backend: Status | null; unavailable: boolean }>({
    session: null,
    backend: null,
    unavailable: false,
  });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let request = 0;
    let running = false;
    const load = () => {
      if (running) return;
      running = true;
      const current = ++request;
      void Promise.resolve()
        .then(() => session.call("backend.status", {}))
        .then(
          (backend) => {
            if (active && current === request) setState({ session, backend, unavailable: false });
          },
          () => {
            if (!active || current !== request) return;
            // Keep a known Paseo backend on transient failures so Pi settings do
            // not reappear. Older servers with no status RPC keep their old UI.
            setState((previous) => ({
              session,
              backend: previous.session === session ? previous.backend : null,
              unavailable: true,
            }));
          },
        )
        .finally(() => { running = false; });
    };
    load();
    const timer = setInterval(load, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [session, enabled]);
  return {
    backend: state.session === session ? state.backend : null,
    loading: enabled && state.session !== session,
    unavailable: state.session === session && state.unavailable,
  };
}

/** Settings use server-reported facts; choosing models stays with the active backend. */
export function BackendStatus({ backend, loading = false, unavailable = false }: { backend: Status | null; loading?: boolean; unavailable?: boolean }) {
  const t = useT();
  if (!backend) return loading ? (
    <p className="mb-6 text-[13px]" style={{ color: "var(--text-secondary)" }} role="status">{t.backend.checking}</p>
  ) : null;
  return (
    <section className="mb-6" aria-label={t.backend.title}>
      <p className="mb-2 text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>{t.backend.title}</p>
      <div className="overflow-hidden rounded-[18px] p-4" style={{ background: "var(--fill-secondary)" }}>
        <div className="flex items-center gap-3">
          <Monitor size={21} className="shrink-0" style={{ color: "var(--icon-secondary)" }} />
          <span className="min-w-0 flex-1 break-words text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>
            {backend.label || (backend.kind === "paseo" ? "Paseo" : "Pi")}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[12px]" style={{ color: unavailable ? "var(--text-secondary)" : backend.connected ? "var(--fill-green)" : "var(--fill-red)" }}>
            {backend.connected && !unavailable ? <Check size={14} /> : <Unplug size={14} />}
            {unavailable ? t.backend.unavailable : backend.connected ? t.backend.connected : t.backend.disconnected}
          </span>
        </div>
        {(unavailable || backend.detail) && <p className="mt-3 break-words text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{unavailable ? t.backend.stale : backend.detail}</p>}
        <dl className="mt-3 space-y-2 text-[13px]">
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
            <dt style={{ color: "var(--text-secondary)" }}>{t.backend.model}</dt>
            <dd className="min-w-0 break-all" style={{ color: "var(--text-primary)" }}>{backend.model ?? (backend.kind === "paseo" ? t.backend.computerDefault : t.backend.notReported)}</dd>
          </div>
          {backend.contextWindow !== null && <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
            <dt style={{ color: "var(--text-secondary)" }}>{t.backend.context}</dt>
            <dd style={{ color: "var(--text-primary)" }}>{backend.contextWindow.toLocaleString()} tokens</dd>
          </div>}
        </dl>
        <p className="mb-2 mt-4 text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>{t.backend.tools}</p>
        {backend.capabilities.length > 0 ? <ul className="flex flex-wrap gap-1.5">
          {backend.capabilities.map((capability) => <li key={capability} className="max-w-full break-words rounded-lg px-2 py-1 text-[12px]" style={{ background: "var(--fill-card-button)", color: "var(--text-primary)" }}>{capability}</li>)}
        </ul> : <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>{t.backend.noTools}</p>}
      </div>
    </section>
  );
}
