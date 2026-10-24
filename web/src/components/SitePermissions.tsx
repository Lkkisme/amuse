/**
 * Settings › Permissions: what Amuse may do in the browser, the server's
 * rules (browser.* and sites.* calls; core/policy.ts). By kind of action,
 * for every website: visit (also reading a page), submit forms (steps with
 * consequences), download files, upload files. Then the exceptions per
 * website: never visit it (which wins over everything), or set any of the
 * four for it and its subdomains; the nearest rule wins over the setting.
 * Deny is a hard no: Amuse does not even ask.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Globe } from "lucide-react";
import { siteOf, withSiteAction } from "@amuse/core";
import {
  type BrowserAction,
  type BrowserRule,
  type Permission,
  type Session,
  Site,
  type SiteEntry,
  type SiteRule,
} from "@amuse/protocol";
import { ACTIONS, mergedEntry, summary } from "../browserRules.ts";
import { Button } from "./Button";
import { ActionSelect, PermissionSelect } from "./PermissionSelect";
import { Sheet } from "./Sheet";
import { useFailure } from "../failure.ts";
import { useT } from "../i18n/react.ts";
import { wordsFor } from "../shown.ts";

/** What the user typed, as a site: "https://www.Bank.com/login" and "bank.com" are both bank.com. */
const asSite = (input: string): string | null => {
  const trimmed = input.trim();
  const site = siteOf(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  return site && Site.safeParse(site).success ? site : null;
};

/** Never visit, and each action: Default (follow the browser's setting), or a choice of its own. */
function RuleEditor({
  entry,
  onChange,
}: {
  entry: SiteEntry | null;
  onChange: (next: SiteEntry | null) => void;
}) {
  const t = useT();
  const never = entry?.never ?? false;
  return (
    <div
      className="w-full overflow-hidden rounded-[18px] px-4 text-left"
      style={{ background: "var(--field)" }}
    >
      <div className="flex items-center justify-between py-2.5 text-[16px]">
        <span style={{ color: "var(--text-primary)" }}>
          {t.permissions.neverVisit}
        </span>
        <button
          role="switch"
          aria-checked={never}
          aria-label={t.permissions.neverVisit}
          className="relative h-[26px] w-[44px] rounded-full transition-colors"
          style={{
            background: never ? "var(--fill-red)" : "var(--fill-tertiary)",
          }}
          onClick={() =>
            onChange(
              withSiteAction(
                entry ?? undefined,
                "never",
                never ? null : "deny",
              ),
            )
          }
        >
          <span
            className="absolute top-[3px] size-[20px] rounded-full bg-white transition-all"
            style={{ left: never ? 21 : 3 }}
          />
        </button>
      </div>
      {never ? (
        <p
          className="border-t py-2.5 text-[13px] leading-snug"
          style={{
            borderColor: "var(--fill-divider)",
            color: "var(--text-secondary)",
          }}
        >
          {t.permissions.neverHelp}
        </p>
      ) : (
        ACTIONS.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between border-t py-2.5 text-[16px]"
            style={{
              borderColor: "var(--fill-divider)",
              color: "var(--text-primary)",
            }}
          >
            {t.permissions.actions[a.id].name}
            <ActionSelect
              value={entry?.actions[a.id] ?? null}
              options={a.options}
              onChange={(p) =>
                onChange(withSiteAction(entry ?? undefined, a.id, p))
              }
            />
          </div>
        ))
      )}
    </div>
  );
}

export function SitePermissions({
  session,
  adding,
  onAdded,
}: {
  session: Session;
  adding: boolean;
  onAdded: () => void;
}) {
  const [browser, setBrowser] = useState<BrowserRule[] | null>(null);
  const [rules, setRules] = useState<SiteRule[] | null>(null);
  const [draft, setDraft] = useState("");
  const [fresh, setFresh] = useState<SiteEntry | null>(null);
  /** the website whose exceptions are open */
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useFailure(session);

  const t = useT();
  const said = setError;
  const load = useCallback(
    () =>
      Promise.all([
        session.call("browser.rules", {}),
        session.call("sites.rules", {}),
      ]).then(([b, s]) => {
        setBrowser(b.rules);
        setRules(s.rules);
      }, said),
    [session],
  );
  useEffect(() => void load(), [load]);

  const setting = (action: BrowserAction, permission: Permission) => {
    setError(null);
    session
      .call("browser.permit", { action, permission })
      .then(load, (e: unknown) => (said(e), load()));
  };
  const permit = (site: string, rule: SiteEntry | null) => {
    setError(null);
    // shown at once; the server's answer follows
    setRules((all) => {
      const others = (all ?? []).filter((r) => r.site !== site);
      return rule && (rule.never || Object.keys(rule.actions).length > 0)
        ? [...others, { site, ...rule }].sort((a, b) =>
            a.site.localeCompare(b.site),
          )
        : others;
    });
    return session
      .call("sites.permit", { site, rule })
      .then(load, (e: unknown) => (said(e), load()));
  };
  const cancel = () => {
    setDraft("");
    setFresh(null);
    setError(null);
    onAdded();
  };
  const add = () => {
    const site = asSite(draft);
    if (!site) return setError(t.permissions.notAddress(draft));
    if (!fresh) return setError(t.permissions.chooseOne);
    // a website that has exceptions already keeps them (a Never above all): what is set here is added to them
    void permit(
      site,
      mergedEntry(rules?.find((r) => r.site === site) ?? null, fresh),
    );
    cancel();
  };
  const open = rules?.find((r) => r.site === editing) ?? null;

  return (
    <div className="flex-1 overflow-y-auto px-5 pb-6 sm:px-6">
      <p
        className="text-[13px] leading-snug"
        style={{ color: "var(--text-secondary)" }}
      >
        {t.permissions.description}
      </p>
      {wordsFor(error, t) && !adding && (
        <p
          role="alert"
          className="mt-2 text-[13px]"
          style={{ color: "var(--fill-red)" }}
        >
          {wordsFor(error, t)}
        </p>
      )}

      <p
        className="mb-2 mt-5 px-1 text-[13px] font-medium"
        style={{ color: "var(--text-secondary)" }}
      >
        {t.permissions.browser}
      </p>
      <ul
        className="divide-y divide-[var(--fill-divider)] rounded-[18px] px-4"
        style={{ background: "var(--fill-secondary)" }}
      >
        {ACTIONS.map((a) => (
          <li key={a.id} className="flex items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-[16px]"
                style={{ color: "var(--text-primary)" }}
              >
                {t.permissions.actions[a.id].name}
              </span>
              <span
                className="block truncate text-[13px]"
                style={{ color: "var(--text-secondary)" }}
              >
                {t.permissions.actions[a.id].about}
              </span>
            </span>
            {browser ? (
              <PermissionSelect
                value={
                  browser.find((r) => r.action === a.id)?.permission ?? "ask"
                }
                options={a.options}
                onChange={(p) => setting(a.id, p)}
              />
            ) : (
              <div className="skeleton h-5 w-14 rounded" />
            )}
          </li>
        ))}
      </ul>

      {/* the bar's + opens this: a sheet from the bottom on a phone, a dialog on a desktop */}
      <Sheet open={adding} onClose={cancel} bare>
        <div className="flex flex-col items-center px-6 pb-6 pt-5 text-center">
          <span
            className="flex size-14 items-center justify-center rounded-[16px]"
            style={{ background: "#ffffff", color: "#111112" }}
          >
            <Globe size={26} />
          </span>
          <p
            className="mt-4 text-[20px] font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {t.settings.addWebsite}
          </p>
          <p
            className="mt-1 text-[14px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {t.permissions.addHelp}
          </p>
          <div
            className="mt-5 w-full overflow-hidden rounded-[18px] text-left"
            style={{ background: "var(--field)" }}
          >
            <input
              autoFocus
              aria-label={t.permissions.website}
              className="w-full bg-transparent px-4 py-3.5 text-[16px] outline-none"
              style={{ color: "var(--text-primary)" }}
              placeholder={t.permissions.websitePlaceholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>
          <div className="mt-3 w-full">
            <RuleEditor entry={fresh} onChange={setFresh} />
          </div>
          {wordsFor(error, t) && (
            <p
              role="alert"
              className="mt-2 text-[13px]"
              style={{ color: "var(--fill-red)" }}
            >
              {wordsFor(error, t)}
            </p>
          )}
          <Button
            variant="primary"
            size="lg"
            className="mt-6"
            disabled={!draft.trim()}
            onClick={add}
          >
            {t.permissions.add}
          </Button>
          <Button variant="plain" size="lg" className="mt-2" onClick={cancel}>
            {t.common.cancel}
          </Button>
        </div>
      </Sheet>

      {/* a website's exceptions: each action, or Default to follow the browser's setting */}
      <Sheet open={open !== null} onClose={() => setEditing(null)} bare>
        <div className="flex flex-col items-center px-6 pb-6 pt-5 text-center">
          <span
            className="flex size-14 items-center justify-center rounded-[16px]"
            style={{ background: "#ffffff", color: "#111112" }}
          >
            <Globe size={26} />
          </span>
          <p
            className="mt-4 break-all text-[20px] font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {editing}
          </p>
          <p
            className="mt-1 text-[14px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {t.permissions.exceptionsHelp}
          </p>
          <div className="mt-5 w-full">
            <RuleEditor
              entry={open ? { never: open.never, actions: open.actions } : null}
              onChange={(next) => {
                if (editing) void permit(editing, next);
                if (!next) setEditing(null);
              }}
            />
          </div>
          <Button
            variant="plain"
            size="lg"
            tone="danger"
            className="mt-4"
            onClick={() => {
              if (editing) void permit(editing, null);
              setEditing(null);
            }}
          >
            {t.permissions.removeExceptions}
          </Button>
          <Button variant="plain" size="lg" onClick={() => setEditing(null)}>
            {t.common.done}
          </Button>
        </div>
      </Sheet>

      <p
        className="mb-2 mt-6 px-1 text-[13px] font-medium"
        style={{ color: "var(--text-secondary)" }}
      >
        {t.permissions.websites}
      </p>
      <ul
        className="divide-y divide-[var(--fill-divider)] rounded-[18px] px-4"
        style={{ background: "var(--fill-secondary)" }}
      >
        {rules?.length === 0 && (
          <li
            className="py-3.5 text-[15px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {t.permissions.noExceptions}
          </li>
        )}
        {rules?.map((rule) => (
          <li key={rule.site}>
            <button
              className="flex w-full items-center gap-3 py-2.5 text-left"
              onClick={() => setEditing(rule.site)}
            >
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-[16px]"
                  style={{ color: "var(--text-primary)" }}
                >
                  {rule.site}
                </span>
                <span
                  className="block truncate text-[13px]"
                  style={{
                    color: rule.never
                      ? "var(--fill-red)"
                      : "var(--text-secondary)",
                  }}
                >
                  {summary(rule)}
                </span>
              </span>
              <ChevronRight
                size={16}
                style={{ color: "var(--icon-secondary)" }}
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
