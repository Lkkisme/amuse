/**
 * Which calls need the PIN (pin.ts): asked by the server for every call, before it runs, so no client can get around
 * it. Sensitive are:
 *   - loosening a permission: an app's kind of action, the browser's for an action (allowing every site to be visited
 *     included), or a site's exceptions, when what follows is more than what was (deny → ask or allow, ask → allow);
 *     and answering a card with anything that lasts beyond this once ("Always allow");
 *   - changing where data goes: a model provider's, Composio's or a voice service's key (setting one up starts with
 *     keys.login), or the address of a speech server;
 *   - the Vault (secrets.*): storing a secret (secrets.add, secrets.setSecret), destroying one (secrets.removeSecret),
 *     deleting an entry and the secret it holds (secrets.remove), and pointing a secret somewhere new (secrets.use).
 *     Listing the Vault, an entry's name, note and plain fields (secrets.edit), and taking a use away (secrets.unuse)
 *     are not: nothing secret is written, and a use taken away is a use no longer delivered.
 * Tightening, "Allow once", disconnecting, signing the browsers out, resetting the sandbox and everyday use are not.
 * The way in (devices, the password, the PIN itself) is the HTTP server's, and checked there (server.ts).
 *
 * A method added later that should be behind the PIN goes here; the Vault's reveal, say, is `case "secrets.reveal":
 * return true`.
 */
import { type Rules, browserPermission, browserActions, defaultBrowser, defaultPermission, permissionOf, setSiteEntry } from "@amuse/core";
import type { Call, Permission } from "@amuse/protocol";

const rank: Record<Permission, number> = { deny: 0, ask: 1, allow: 2 };
const looser = (next: Permission, before: Permission) => rank[next] > rank[before];

export async function sensitive(call: Call, rules: Rules): Promise<boolean> {
  switch (call.method) {
    case "approval.resolve":
      return call.params.resolution === "allow_always" || call.params.resolution === "allow_session";
    case "apps.permit": {
      const { app, kind, permission } = call.params;
      return looser(permission ?? defaultPermission(kind), permissionOf(kind, await rules.of(app)));
    }
    case "browser.permit": {
      const { action, permission } = call.params;
      return looser(permission ?? defaultBrowser[action], (await rules.browser())[action] ?? defaultBrowser[action]);
    }
    case "sites.permit": {
      const { site, rule } = call.params;
      const actions = await rules.browser();
      const sites = await rules.sites();
      const before = { actions, sites };
      const after = { actions, sites: setSiteEntry(sites, site, rule) };
      const url = `https://${site}/`;
      return browserActions.some((action) => looser(browserPermission(after, url, action), browserPermission(before, url, action)));
    }
    case "keys.login":
      return true;
    case "models.localVoice":
      return call.params.service !== null;
    case "secrets.add":
    case "secrets.setSecret":
    case "secrets.removeSecret":
    case "secrets.use":
    case "secrets.remove":
      return true;
    default:
      return false;
  }
}
