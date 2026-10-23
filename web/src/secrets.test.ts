import assert from "node:assert/strict";
import { test } from "node:test";
import type { SecretEntry } from "@amuse/protocol";
import { en } from "./i18n/en.ts";
import {
  type Draft,
  blank,
  describeUse,
  encodeText,
  formatSize,
  groupOf,
  homePath,
  matches,
  pasted,
  problem,
  toValue,
  usesSummary,
} from "./secrets.ts";

const names = new Map([["openai", "OpenAI"]]);
const entry = (uses: SecretEntry["uses"]): SecretEntry => ({
  id: "s1",
  name: "Cloudflare",
  managed: false,
  plain: [],
  secret: [{ name: "token", role: null, kind: "text", filename: null, size: 0, hint: null, last: null }],
  note: "",
  uses,
  created: "2026-10-23T00:00:00.000Z",
});
type Use = SecretEntry["uses"][number];
const env: Use = { id: "u1", kind: "env", field: "token", name: "CF_API_TOKEN" };
const server: Use = { id: "u2", kind: "server", field: "token", service: "model", target: "openai" };
const file: Use = { id: "u3", kind: "file", field: "token", path: ".config/x/key.json", env: null };

test("a pasted file is UTF-8 in base64, named by the field unless it is named", () => {
  assert.equal(encodeText("héllo"), "aMOpbGxv");
  assert.deepEqual(toValue(pasted("a", ""), "key.json"), { kind: "file", filename: "key.json", content: "YQ==" });
  assert.deepEqual(toValue(pasted("a", "other.json"), "key.json"), { kind: "file", filename: "other.json", content: "YQ==" });
  assert.equal(toValue(pasted("", ""), "key.json"), null);
  assert.equal(toValue(pasted("x".repeat(64 * 1024 + 1), ""), "key.json"), null);
});

test("a line of text is a value when it is there and has no line breaks", () => {
  assert.equal(toValue({ kind: "text", text: "" }, "key"), null);
  assert.equal(toValue({ kind: "text", text: "a\nb" }, "key"), null);
  assert.deepEqual(toValue({ kind: "text", text: " a b " }, "key"), { kind: "text", text: " a b " });
});

test("an entry is not saved without a name, with unnamed or twice-named fields, or with a value missing", () => {
  const text = (value: string): Draft => ({ kind: "text", text: value });
  const ok = { name: "Site", plain: [{ name: "username", draft: text("me") }], secret: [{ name: "password", draft: text("fake-pass") }] };
  assert.equal(problem(ok), null);
  assert.equal(problem({ ...ok, name: " " }), "name");
  assert.equal(problem({ ...ok, secret: [{ name: "", draft: text("x") }] }), "fieldName");
  assert.equal(problem({ ...ok, secret: [{ name: "username", draft: text("x") }] }), "twice");
  assert.equal(problem({ ...ok, secret: [{ name: "password", draft: blank("text") }] }), "value");
  // an entry being edited keeps its secret values
  assert.equal(problem({ ...ok, secret: [{ name: "password", draft: null }] }), null);
});

test("uses are told in words, and the server's name its provider", () => {
  assert.equal(describeUse(env, names, en), "$CF_API_TOKEN");
  assert.equal(describeUse(server, names, en), "OpenAI models");
  assert.equal(describeUse({ ...server, target: "local" }, names, en), "local models");
  assert.equal(describeUse(file, names, en), "file .config/x/key.json");
  assert.equal(
    describeUse({ kind: "file", field: "key.json", path: "~/.config/g/key.json", env: "GOOGLE_APPLICATION_CREDENTIALS" }, names, en),
    "file .config/g/key.json, and $GOOGLE_APPLICATION_CREDENTIALS holds its path",
  );
  assert.equal(usesSummary(entry([]), names, en), "Not used");
  assert.equal(usesSummary(entry([env, server]), names, en), "$CF_API_TOKEN, OpenAI models");
});

test("an entry is in the sandbox's list if anything of the sandbox uses it, else the server's, else not used", () => {
  assert.equal(groupOf(entry([env, server])), "sandbox");
  assert.equal(groupOf(entry([server])), "server");
  assert.equal(groupOf(entry([])), "none");
});

test("searching looks at the name, the fields' names and the uses", () => {
  const e = entry([env, server]);
  for (const query of ["cloud", "TOKEN", "cf_api", "openai", " "]) assert.ok(matches(e, query, names, en), query);
  assert.ok(!matches(e, "gcloud", names, en));
});

test("a home path loses its ~/ and a leading slash; a size is told short", () => {
  assert.equal(homePath(" ~/.config/x "), ".config/x");
  assert.equal(homePath("/a/b"), "a/b");
  assert.equal(formatSize(812), "812 B");
  assert.equal(formatSize(2458), "2.4 KB");
});

test("the Vault's screens never reveal or copy a secret: no clipboard, no show button, and a replaced value starts blank", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const folder = new URL("./components/", import.meta.url);
  const screens = readdirSync(folder).filter((name) => /^Secret.*\.tsx$/.test(name));
  assert.ok(screens.length >= 4);
  for (const name of screens) {
    const source = readFileSync(new URL(name, folder), "utf8");
    assert.doesNotMatch(source, /clipboard|writeText|execCommand\(["']copy/i, `${name} copies something`);
    assert.doesNotMatch(source, /\b(reveal|showSecret|showValue|unmask)\b/i, `${name} reveals something`);
  }
  // a secret's input is a password input, and the replace form begins from an empty draft
  assert.match(readFileSync(new URL("SecretFields.tsx", folder), "utf8"), /type=\{secret \? "password" : "text"\}/);
  assert.match(readFileSync(new URL("SecretEntryPage.tsx", folder), "utf8"), /blank\(/);
});

test("a request card has no input for a plain field: what the user types there is secret, and the plain fields are shown as text", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./components/cards.tsx", import.meta.url), "utf8");
  const form = source.slice(source.indexOf("function StoredForm"), source.indexOf("/* ---------- Failure"));
  // every editor on the card is a secret one, and nothing of the answer is plain
  assert.doesNotMatch(form, /secret=\{false\}|setPlain|plainValues/);
  assert.match(form, /ValueEditor[^>]*\bsecret\b/);
  assert.match(form, /kind: "stored", secret: secretValues/);
  assert.match(form, /ask\.plain\.map/);
});
