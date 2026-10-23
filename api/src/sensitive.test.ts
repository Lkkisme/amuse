import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryRules } from "@amuse/core";
import type { Call, FieldValue } from "@amuse/protocol";
import { sensitive } from "./sensitive.ts";

test("loosening a permission needs the PIN; tightening it, or setting what it already is, does not", async () => {
  const rules = memoryRules();
  await rules.set("gmail", "destructive", "deny");
  await rules.setBrowser("download", "deny");
  await rules.setSite("bank.example", { never: true, actions: {} });
  await rules.setSite("news.example", { never: false, actions: { submit: "deny" } });
  const cases: [Call, boolean][] = [
    // an app's kind of action (writing is "ask" by default, reading "allow")
    [{ method: "apps.permit", params: { app: "gmail", kind: "write", permission: "allow" } }, true],
    [{ method: "apps.permit", params: { app: "gmail", kind: "write", permission: "deny" } }, false],
    [{ method: "apps.permit", params: { app: "gmail", kind: "write", permission: "ask" } }, false],
    [{ method: "apps.permit", params: { app: "gmail", kind: "destructive", permission: "ask" } }, true],
    [{ method: "apps.permit", params: { app: "gmail", kind: "destructive", permission: null } }, true],
    [{ method: "apps.permit", params: { app: "gmail", kind: "read", permission: null } }, false],
    // the browser, everywhere: allowing every site to be visited by default is loosening too
    [{ method: "browser.permit", params: { action: "visit", permission: "allow" } }, true],
    [{ method: "browser.permit", params: { action: "visit", permission: "deny" } }, false],
    [{ method: "browser.permit", params: { action: "download", permission: null } }, true],
    [{ method: "browser.permit", params: { action: "submit", permission: "ask" } }, false],
    // a site's exceptions
    [{ method: "sites.permit", params: { site: "bank.example", rule: null } }, true],
    [{ method: "sites.permit", params: { site: "bank.example", rule: { never: false, actions: { visit: "ask" } } } }, true],
    [{ method: "sites.permit", params: { site: "news.example", rule: { never: false, actions: { submit: "ask" } } } }, true],
    [{ method: "sites.permit", params: { site: "news.example", rule: { never: true, actions: {} } } }, false],
    [{ method: "sites.permit", params: { site: "new.example", rule: { never: false, actions: { visit: "deny" } } } }, false],
    [{ method: "sites.permit", params: { site: "new.example", rule: { never: false, actions: { visit: "allow" } } } }, true],
  ];
  for (const [call, expected] of cases) assert.equal(await sensitive(call, rules), expected, JSON.stringify(call));
});

test("Always allow on a card needs the PIN, Allow once does not; keys and a speech server's address do; the rest does not", async () => {
  const rules = memoryRules();
  const cases: [Call, boolean][] = [
    [{ method: "approval.resolve", params: { id: "a", resolution: "allow_always" } }, true],
    [{ method: "approval.resolve", params: { id: "a", resolution: "allow_session" } }, true],
    [{ method: "approval.resolve", params: { id: "a", resolution: "allow_once" } }, false],
    [{ method: "approval.resolve", params: { id: "a", resolution: "deny_always" } }, false],
    [{ method: "keys.login", params: { provider: "anthropic" } }, true],
    [{ method: "keys.logout", params: { provider: "anthropic" } }, false],
    [{ method: "models.localVoice", params: { service: { url: "http://speech:8000", model: "whisper", key: null } } }, true],
    [{ method: "models.localVoice", params: { service: null } }, false],
    [{ method: "secrets.remove", params: { id: "s" } }, true],
    [{ method: "apps.disconnect", params: { account: "a" } }, false],
    [{ method: "logins.forget", params: { site: "example.com" } }, false],
    [{ method: "sandbox.reset", params: {} }, false],
    [{ method: "chats.list", params: {} }, false],
  ];
  for (const [call, expected] of cases) assert.equal(await sensitive(call, rules), expected, call.method);
});

test("the Vault: storing, replacing or destroying a secret needs the PIN, and pointing one somewhere new; listing it, its name and note, and taking a use away do not", async () => {
  const rules = memoryRules();
  const text: FieldValue = { kind: "text", text: "a made-up value" };
  const cases: [Call, boolean][] = [
    // a secret is stored: adding an entry, and replacing or adding a field on one
    [{ method: "secrets.add", params: { name: "Mail", note: "", plain: [], secret: [{ name: "token", role: null, value: text }], uses: [] } }, true],
    [{ method: "secrets.add", params: { name: "Mail", note: "", plain: [{ name: "account", role: null, value: text }], secret: [{ name: "token", role: null, value: text }], uses: [{ kind: "env", field: "token", name: "MAIL_TOKEN" }] } }, true],
    [{ method: "secrets.setSecret", params: { id: "s", field: { name: "token", role: null, value: text } } }, true],
    // a secret is destroyed, like the entry itself
    [{ method: "secrets.removeSecret", params: { id: "s", name: "token" } }, true],
    [{ method: "secrets.remove", params: { id: "s" } }, true],
    // where a secret goes: into the sandbox, or to a service of the server's own
    [{ method: "secrets.use", params: { id: "s", use: { kind: "env", field: "token", name: "MAIL_TOKEN" } } }, true],
    [{ method: "secrets.use", params: { id: "s", use: { kind: "file", field: "key.json", path: ".config/mail/key.json", env: null } } }, true],
    [{ method: "secrets.use", params: { id: "s", use: { kind: "server", field: "token", service: "apps", target: "composio" } } }, true],
    // reading the Vault, what is there to see, and a use taken away (tightening)
    [{ method: "secrets.list", params: {} }, false],
    [{ method: "secrets.edit", params: { id: "s", name: "Mail", note: "", plain: [{ name: "account", role: null, value: text }] } }, false],
    [{ method: "secrets.unuse", params: { id: "s", use: "u-1" } }, false],
  ];
  for (const [call, expected] of cases) assert.equal(await sensitive(call, rules), expected, JSON.stringify(call));
});
