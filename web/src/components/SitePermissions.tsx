/**
 * Settings › Permissions: what the browser agent may do on each website, the
 * server's rules (sites.* calls). A site not listed is asked about: the agent
 * may browse it and asks before any step that commits the user. Allow: it
 * goes ahead without asking. Deny: it never goes there (a link or redirect
 * there is undone). A rule covers the site's subdomains too.
 */
import { useCallback, useEffect, useState } from "react";
import { Globe, X } from "lucide-react";
import { siteOf } from "@remuse/core";
import {
  type Permission,
  type Session,
  Site,
  type SiteRule,
} from "@remuse/protocol";
import { PermissionSelect } from "./PermissionSelect";

/** What the user typed, as a site: "https://www.Bank.com/login" and "bank.com" are both bank.com. */
const asSite = (input: string): string | null => {
  const trimmed = input.trim();
  const site = siteOf(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  return site && Site.safeParse(site).success ? site : null;
};

export function SitePermissions({ session }: { session: Session }) {
  const [rules, setRules] = useState<SiteRule[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      session.call("sites.rules", {}).then(
        ({ rules }) => setRules(rules),
        (e: unknown) => setError(String(e)),
      ),
    [session],
  );
  useEffect(() => void load(), [load]);
  const permit = (site: string, permission: Permission | null) => {
    setError(null);
    session
      .call("sites.permit", { site, permission })
      .then(load, (e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
  };
  const add = () => {
    const site = asSite(draft);
    if (!site) return setError(`“${draft}” is not a website address.`);
    permit(site, "deny"); // most rules keep the agent off a site; the list sets any other
    setDraft("");
  };

  return (
    <div className="flex-1 overflow-y-auto px-5 pb-6 pt-4 sm:px-6">
      <h2
        className="text-[20px] font-semibold"
        style={{ color: "var(--text-primary)" }}
      >
        Websites
      </h2>
      <p
        className="mt-1 text-[13px] leading-snug"
        style={{ color: "var(--text-secondary)" }}
      >
        Muse can visit any other website and asks you before anything that
        commits you (buying, sending, submitting). Allow lets it go ahead
        without asking; Deny keeps it off the site altogether. A rule covers the
        site's subdomains too.
      </p>

      {rules && rules.length > 0 && (
        <ul
          className="mt-4 divide-y divide-[var(--fill-divider)] rounded-[18px] px-4"
          style={{ background: "var(--fill-secondary)" }}
        >
          {rules?.map((rule) => (
            <li key={rule.site} className="flex items-center gap-3 py-2.5">
              <Globe size={16} style={{ color: "var(--icon-secondary)" }} />
              <span
                className="min-w-0 flex-1 truncate text-[15px]"
                style={{ color: "var(--text-primary)" }}
              >
                {rule.site}
              </span>
              <PermissionSelect
                value={rule.permission}
                onChange={(p) => permit(rule.site, p)}
              />
              <button
                aria-label={`Remove the rule for ${rule.site}`}
                className="hover-fade rounded-full p-1"
                style={{ color: "var(--icon-secondary)" }}
                onClick={() => permit(rule.site, null)}
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* a site added is denied at first; its row in the list sets any other rule */}
      <div
        className="mt-3 flex h-11 items-center gap-2 rounded-full pl-4 pr-1.5"
        style={{ background: "var(--fill-secondary)" }}
      >
        <input
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
          style={{ color: "var(--text-primary)" }}
          placeholder="Block a website, like bank.com"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && draft.trim() && add()}
        />
        <button
          disabled={!draft.trim()}
          className="h-8 shrink-0 rounded-full px-4 text-[14px] font-medium text-white disabled:opacity-40"
          style={{ background: "var(--fill-blue)" }}
          onClick={add}
        >
          Add
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-2 text-[13px]"
          style={{ color: "var(--fill-red)" }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
