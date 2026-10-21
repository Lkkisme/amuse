/**
 * Settings › Permissions: what Muse may do on each website, the server's rules
 * (sites.* calls; core/policy.ts), Muse's Allow / Ask / Deny. A site not
 * listed is not visited until the user allows it (Muse asks). Allow: it visits
 * and acts without asking. Ask: it visits, and asks before any step that
 * commits the user. Deny: it never goes there and does not ask (a link or
 * redirect there is undone). A rule covers the site's subdomains too.
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

export function SitePermissions({
  session,
  adding,
  onAdded,
}: {
  session: Session;
  adding: boolean;
  onAdded: () => void;
}) {
  const [rules, setRules] = useState<SiteRule[] | null>(null);
  const [draft, setDraft] = useState("");
  const [permission, setPermission] = useState<Permission>("ask");
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
  const permit = (site: string, next: Permission | null) => {
    setError(null);
    session
      .call("sites.permit", { site, permission: next })
      .then(load, (e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
  };
  const add = () => {
    const site = asSite(draft);
    if (!site) return setError(`“${draft}” is not a website address.`);
    permit(site, permission);
    setDraft("");
    setPermission("ask");
    onAdded();
  };

  return (
    <div className="flex-1 overflow-y-auto px-5 pb-6 sm:px-6">
      <p
        className="text-[13px] leading-snug"
        style={{ color: "var(--text-secondary)" }}
      >
        Muse asks before visiting a website that is not listed here. Ask lets it
        go there, and it still asks before anything that commits you (buying,
        sending, submitting); Allow lets it act there without asking; Deny keeps
        it off the site and stops it asking. A rule covers the site's subdomains
        too.
      </p>

      {/* the bar's + opens this */}
      {adding && (
        <div
          className="anim-fade-in mt-4 space-y-2.5 rounded-[18px] p-4"
          style={{ background: "var(--fill-secondary)" }}
        >
          <div
            className="flex items-center gap-2 rounded-[10px] px-3"
            style={{ background: "var(--field)" }}
          >
            <Globe size={16} style={{ color: "var(--icon-secondary)" }} />
            <input
              autoFocus
              aria-label="Website"
              className="min-w-0 flex-1 bg-transparent py-2 text-[15px] outline-none"
              style={{ color: "var(--text-primary)" }}
              placeholder="news.ycombinator.com"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && draft.trim() && add()}
            />
            <PermissionSelect value={permission} onChange={setPermission} />
          </div>
          <button
            disabled={!draft.trim()}
            className="h-10 w-full rounded-full text-[15px] font-semibold text-white disabled:opacity-40"
            style={{ background: "var(--fill-blue)" }}
            onClick={add}
          >
            Add
          </button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="mt-2 text-[13px]"
          style={{ color: "var(--fill-red)" }}
        >
          {error}
        </p>
      )}

      <p
        className="mb-2 mt-6 px-1 text-[13px] font-medium"
        style={{ color: "var(--text-secondary)" }}
      >
        Websites
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
            None yet. Add one with +.
          </li>
        )}
        {rules?.map((rule) => (
          <li key={rule.site} className="flex items-center gap-3 py-2.5">
            <span
              className="min-w-0 flex-1 truncate text-[16px]"
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
    </div>
  );
}
