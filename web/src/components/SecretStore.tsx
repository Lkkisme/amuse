/**
 * Settings › Vault: the keys and passwords Amuse keeps, as a phone's password manager lists them: one line each, with
 * where it is used; an entry's page; and adding one.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, KeyRound, Plus, Search } from "lucide-react";
import type { SecretEntry, Session } from "@amuse/protocol";
import { Button } from "./Button";
import { useT } from "../i18n/react.ts";
import { wordsOf } from "../shown.ts";
import { type ProviderNames, matches, usesSummary } from "../secrets.ts";
import type { SecretPage } from "../ui.ts";
import { SecretForm } from "./SecretForm";
import { SecretEntryPage } from "./SecretEntryPage";
import { ErrorState } from "./Errors";
import { groupClass } from "./SecretFields";
import { detailOf } from "../ask.tsx";

/** The search shows once there are this many entries: fewer are seen at a glance. */
const SEARCH_FROM = 8;

/** `page`: the entry open, or the form to add one (the settings' own state, so a phone's back button can leave it). */
export function SecretStore({
  session,
  page,
  onPage,
}: {
  session: Session;
  page: SecretPage | null;
  onPage: (page: SecretPage | null) => void;
}) {
  const t = useT();
  const [entries, setEntries] = useState<SecretEntry[] | null>(null);
  const [names, setNames] = useState<ProviderNames>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(
    () =>
      session.call("secrets.list", {}).then(
        ({ entries }) => setEntries(entries),
        (e: unknown) => setError(wordsOf(e)),
      ),
    [session],
  );
  useEffect(() => void load(), [load]);
  // the providers' names, for the uses that name one by id; without them the id is shown
  useEffect(() => {
    void session.call("keys.list", {}).then(
      ({ providers }) => setNames(new Map(providers.map((p) => [p.id, p.name]))),
      () => undefined,
    );
  }, [session]);

  const open = page?.kind === "entry" ? entries?.find((entry) => entry.id === page.id) : undefined;
  // an entry that is gone (removed here, or elsewhere) leaves its page
  const gone = page?.kind === "entry" && entries !== null && open === undefined;
  useEffect(() => {
    if (gone) onPage(null);
  }, [gone, onPage]);

  const shown = useMemo(
    () => (entries ?? []).filter((entry) => matches(entry, query, names, t)),
    [entries, query, names, t],
  );

  if (page?.kind === "add")
    return (
      <SecretForm
        session={session}
        onBack={() => onPage(null)}
        onAdded={() => {
          void load();
          onPage(null);
        }}
      />
    );
  if (open)
    return (
      <SecretEntryPage
        key={open.id}
        session={session}
        entry={open}
        names={names}
        onBack={() => onPage(null)}
        onChanged={load}
        onRenamed={(name) => onPage({ kind: "entry", id: open.id, name })}
      />
    );

  return (
    <div className="flex-1 overflow-y-auto px-5 pb-6 sm:px-6">
      <p className="text-[13px] leading-snug" style={{ color: "var(--text-secondary)" }}>
        {t.secrets.intro}
      </p>
      {error !== null && (
        <ErrorState
          title={t.ask.loadTitle}
          message={error}
          detail={detailOf("Vault", "", "secrets_list_failed")}
          retry={() => {
            setError(null);
            void load();
          }}
        />
      )}

      {entries === null && error === null && (
        <ul className={`${groupClass} mt-4`} style={{ background: "var(--fill-secondary)" }}>
          {[0, 1, 2].map((i) => (
            <li key={i} className="py-3">
              <div className="skeleton h-5 w-2/5 rounded" />
            </li>
          ))}
        </ul>
      )}

      {entries?.length === 0 && (
        <div className="mt-4 rounded-[18px] px-4 py-5 text-center" style={{ background: "var(--fill-secondary)" }}>
          <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>
            {t.secrets.empty}
          </p>
          <Button variant="primary" className="mt-4" onClick={() => onPage({ kind: "add" })}>
            <Plus size={15} />
            {t.secrets.add}
          </Button>
        </div>
      )}

      {entries !== null && entries.length > 0 && (
        <>
          {entries.length >= SEARCH_FROM && (
            <label
              className="mb-2 mt-4 flex items-center gap-2 rounded-full px-4 py-2.5"
              style={{ background: "var(--field)" }}
            >
              <Search size={16} style={{ color: "var(--icon-secondary)" }} />
              <input
                aria-label={t.secrets.search}
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
                style={{ color: "var(--text-primary)" }}
                placeholder={t.secrets.search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )}
          {shown.length === 0 && (
            <p className="mt-4 px-1 text-[14px]" style={{ color: "var(--text-secondary)" }}>
              {t.secrets.noMatch(query.trim())}
            </p>
          )}
          <ul className={groupClass} style={{ background: "var(--fill-secondary)" }}>
            {shown.map((entry) => (
              <li key={entry.id}>
                <button
                  className="flex w-full items-center gap-3 py-2.5 text-left"
                  onClick={() => onPage({ kind: "entry", id: entry.id, name: entry.name })}
                >
                  <KeyRound size={18} style={{ color: "var(--icon-secondary)" }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px]" style={{ color: "var(--text-primary)" }}>
                      {entry.name}
                    </span>
                    <span className="block truncate text-[13px]" style={{ color: "var(--text-secondary)" }}>
                      {usesSummary(entry, names, t)}
                    </span>
                  </span>
                  <ChevronRight size={16} style={{ color: "var(--icon-secondary)" }} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
