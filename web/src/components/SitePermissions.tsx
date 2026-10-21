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
import { Sheet } from "./Sheet";

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
  const cancel = () => {
    setDraft("");
    setError(null);
    onAdded();
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
        Muse asks before visiting a website not listed here.
      </p>
      <ul
        className="mt-2 space-y-0.5 text-[13px] leading-snug"
        style={{ color: "var(--text-secondary)" }}
      >
        <li>
          <b className="font-medium" style={{ color: "var(--text-primary)" }}>
            Allow
          </b>{" "}
          visits and acts without asking
        </li>
        <li>
          <b className="font-medium" style={{ color: "var(--text-primary)" }}>
            Ask
          </b>{" "}
          visits, asks before buying, sending or submitting
        </li>
        <li>
          <b className="font-medium" style={{ color: "var(--text-primary)" }}>
            Deny
          </b>{" "}
          never goes there
        </li>
      </ul>
      {error && !adding && (
        <p
          role="alert"
          className="mt-2 text-[13px]"
          style={{ color: "var(--fill-red)" }}
        >
          {error}
        </p>
      )}

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
            Add a website
          </p>
          <p
            className="mt-1 text-[14px]"
            style={{ color: "var(--text-secondary)" }}
          >
            What Muse may do there
          </p>
          <div
            className="mt-5 w-full overflow-hidden rounded-[18px] text-left"
            style={{ background: "var(--field)" }}
          >
            <input
              autoFocus
              aria-label="Website"
              className="w-full bg-transparent px-4 py-3.5 text-[16px] outline-none"
              style={{ color: "var(--text-primary)" }}
              placeholder="Website, like news.ycombinator.com"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && draft.trim() && add()}
            />
            <div
              className="mx-4 border-t"
              style={{ borderColor: "var(--fill-divider)" }}
            />
            <div
              className="flex items-center justify-between px-4 py-2.5 text-[16px]"
              style={{ color: "var(--text-secondary)" }}
            >
              Muse may
              <PermissionSelect value={permission} onChange={setPermission} />
            </div>
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
          <button
            disabled={!draft.trim()}
            className="mt-6 h-12 w-full rounded-full text-[16px] font-semibold text-white disabled:opacity-40"
            style={{ background: "var(--fill-blue)" }}
            onClick={add}
          >
            Add
          </button>
          <button
            className="hover-fade mt-2 h-11 w-full rounded-full text-[16px] font-medium"
            style={{ color: "var(--text-primary)" }}
            onClick={cancel}
          >
            Cancel
          </button>
        </div>
      </Sheet>

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
