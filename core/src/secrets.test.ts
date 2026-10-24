import assert from "node:assert/strict";
import { test } from "node:test";
import type { SecretEntry, SecretField } from "@amuse/protocol";
import { SANDBOX_HOME, checkUse, hintOf, labelOf, maskings, pathInHome, serving } from "./secrets.ts";

const secret = (name: string, kind: SecretField["kind"] = "text"): SecretField => ({ name, role: null, kind, filename: null, size: 10, hint: null, last: null });
const entry = (id: string, name: string, over: Partial<SecretEntry> = {}): SecretEntry => ({
  id,
  name,
  managed: false,
  plain: [],
  secret: [secret("token")],
  note: "",
  uses: [],
  created: "2026-10-23T00:00:00Z",
  ...over,
});

test("a path is in the home folder, in whatever way it is written; going up out of it, leaving it, or the workspace is not", () => {
  assert.equal(pathInHome(".config/tool/key", SANDBOX_HOME), ".config/tool/key");
  assert.equal(pathInHome("~/.config//tool/./key", SANDBOX_HOME), ".config/tool/key");
  assert.equal(pathInHome("/home/amuse/.config/tool/key", SANDBOX_HOME), ".config/tool/key");
  for (const refused of ["../outside", "a/../../b", "~/", "~", "/home/amuse", "/home/amuse/", "/etc/passwd", "/workspace/x", "a\0b"])
    assert.equal(pathInHome(refused, SANDBOX_HOME), null, refused);
  // the workspace, however it is spelled: it is read by the user and by Amuse's own tools
  for (const workspace of ["workspace", "workspace/x", "~/workspace/x", "/home/amuse/workspace/x", "./workspace/./x", "workspace//x", "a/../workspace/x"])
    assert.equal(pathInHome(workspace, SANDBOX_HOME), null, workspace);
  assert.equal(pathInHome("workspaces/x", SANDBOX_HOME), "workspaces/x", "another folder that starts the same");
  assert.equal(pathInHome(".workspace/x", SANDBOX_HOME), ".workspace/x");
});

test("a secret shows the end of itself only when it is long enough to do so safely", () => {
  assert.equal(hintOf("short-fake-12345678"), null);
  assert.equal(hintOf("long-fake-value-123456789"), "…6789");
  assert.equal(hintOf("exactly-twenty-chars!"), "…ars!");
});

test("a variable, a file or a service belongs to one field: a taken one is refused, saying by whom", () => {
  const a = entry("e1", "Cloudflare", { uses: [{ id: "u1", kind: "env", field: "token", name: "CF_TOKEN" }] });
  const b = entry("e2", "OpenAI", { uses: [{ id: "u2", kind: "server", field: "token", service: "model", target: "openai" }] });
  const all = [a, b];
  const taken = checkUse(all, "e2", { kind: "env", field: "token", name: "CF_TOKEN" }, SANDBOX_HOME);
  assert.deepEqual(taken, { ok: false, reason: "$CF_TOKEN is already used by Cloudflare token." });
  assert.equal(checkUse(all, "e1", { kind: "env", field: "token", name: "CF_TOKEN" }, SANDBOX_HOME).ok, false);
  assert.equal(checkUse(all, "e1", { kind: "server", field: "token", service: "model", target: "openai" }, SANDBOX_HOME).ok, false);
  assert.equal(checkUse(all, "e1", { kind: "env", field: "token", name: "CLOUDFLARE_API_TOKEN" }, SANDBOX_HOME).ok, true);
  // a file's variable for its path is a variable too
  const files = entry("e3", "GCP", { secret: [secret("key.json", "file")], uses: [{ id: "u3", kind: "file", field: "key.json", path: ".config/gcloud/key.json", env: "GOOGLE_APPLICATION_CREDENTIALS" }] });
  const clash = checkUse([...all, files], "e1", { kind: "env", field: "token", name: "GOOGLE_APPLICATION_CREDENTIALS" }, SANDBOX_HOME);
  assert.equal(clash.ok, false);
  const samePath = checkUse([...all, files], "e1", { kind: "file", field: "token", path: "~/.config/gcloud/key.json", env: null }, SANDBOX_HOME);
  assert.equal(samePath.ok, false);
  assert.equal(checkUse(all, "e1", { kind: "env", field: "nope", name: "X" }, SANDBOX_HOME).ok, false);
  assert.equal(checkUse(all, "e1", { kind: "file", field: "token", path: "../x", env: null }, SANDBOX_HOME).ok, false);
});

test("the card is for a secret field's first use in the sandbox: not a second name for it, a plain field, or a service of the server's", () => {
  const e = entry("e1", "Account", {
    plain: [{ name: "region", role: null, value: { kind: "text", text: "eu-1" } }],
    secret: [secret("token"), secret("other")],
    uses: [{ id: "u1", kind: "env", field: "token", name: "TOKEN" }],
  });
  const need = (field: string, name: string) => {
    const checked = checkUse([e], "e1", { kind: "env", field, name }, SANDBOX_HOME);
    return checked.ok ? checked.needsCard : null;
  };
  assert.equal(need("other", "OTHER"), true);
  assert.equal(need("token", "TOKEN_ALIAS"), false);
  assert.equal(need("region", "REGION"), false);
  const server = checkUse([e], "e1", { kind: "server", field: "other", service: "apps", target: "composio" }, SANDBOX_HOME);
  assert.deepEqual(server.ok && server.needsCard, false);
});

test("only a line of secret text serves a service; a file is too big for a variable past 20 KB", () => {
  const e = entry("e1", "GCP", { secret: [secret("key.json", "file"), secret("token")], plain: [{ name: "id", role: null, value: { kind: "text", text: "p" } }] });
  assert.equal(checkUse([e], "e1", { kind: "server", field: "key.json", service: "model", target: "x" }, SANDBOX_HOME).ok, false);
  assert.equal(checkUse([e], "e1", { kind: "server", field: "id", service: "model", target: "x" }, SANDBOX_HOME).ok, false);
  const big = entry("e2", "Big", { secret: [{ ...secret("key.json", "file"), size: 30_000 }] });
  assert.equal(checkUse([big], "e2", { kind: "env", field: "key.json", name: "KEY_JSON" }, SANDBOX_HOME).ok, false);
  assert.equal(checkUse([big], "e2", { kind: "file", field: "key.json", path: "k.json", env: "KEY_PATH" }, SANDBOX_HOME).ok, true);
});

test("a service is looked up by what it serves, never by the entry", () => {
  const e = entry("e1", "OpenAI", { uses: [{ id: "u1", kind: "server", field: "token", service: "model", target: "openai" }] });
  assert.equal(serving([e], "model", "openai")?.entry.id, "e1");
  assert.equal(serving([e], "voice", "openai"), undefined);
});

test("an entry with one secret field is labelled by its name alone", () => {
  assert.equal(labelOf(entry("e1", "Cloudflare"), "token"), "Cloudflare");
  assert.equal(labelOf(entry("e1", "Site", { secret: [secret("password"), secret("pin")] }), "pin"), "Site pin");
});

test("a key file is masked whole, by line, and by every long string in its JSON", () => {
  const privateKey = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj\n-----END PRIVATE KEY-----\n";
  const json = JSON.stringify({ type: "service_account", project_id: "demo", private_key_id: "0123456789abcdef0123", private_key: privateKey }, null, 2);
  const values = maskings("GCP key.json", new TextEncoder().encode(json)).map((m) => m.value);
  assert.ok(values.includes(json), "the whole");
  assert.ok(values.includes("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC"), "a line of the key");
  assert.ok(values.includes("0123456789abcdef0123"), "a string of 16 or more");
  assert.ok(values.includes(privateKey), "the key as a program decodes it");
  assert.ok(values.includes(JSON.stringify(privateKey).slice(1, -1)), "the key as the file has it, escapes and all");
  assert.ok(!values.includes("demo"), "a short string is a plain word");
  assert.ok(!values.includes("{"));
  assert.ok(maskings("GCP key.json", new TextEncoder().encode(json)).every((m) => m.name === "GCP key.json"));
});

test("a keystore that is not text is masked as base64", () => {
  const bytes = Uint8Array.from([0, 255, 254, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(maskings("Store", bytes), [{ name: "Store", value: btoa(String.fromCharCode(...bytes)) }]);
});

test("a line of text is masked as it is, and as JSON writes it when it has quotes or backslashes", () => {
  assert.deepEqual(maskings("Cloudflare", "cf-token-123456"), [{ name: "Cloudflare", value: "cf-token-123456" }]);
  assert.deepEqual(maskings("Odd", 'a"b\\c-123456'), [{ name: "Odd", value: 'a"b\\c-123456' }, { name: "Odd", value: 'a\\"b\\\\c-123456' }]);
});
