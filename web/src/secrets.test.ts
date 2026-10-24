import assert from "node:assert/strict";
import { test } from "node:test";
import type { SecretEntry } from "@amuse/protocol";
import { en } from "./i18n/en.ts";
import { zhCN } from "./i18n/zh-CN.ts";
import {
  type Draft,
  blank,
  describeUse,
  encodeText,
  labelOf,
  typedSecret,
  useSentence,
  valueText,
  formatSize,
  homePath,
  matches,
  pasted,
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

test("a secret typed on one line is text, on several lines it is kept whole; a plain line must have text", () => {
  assert.deepEqual(typedSecret(" sk-fake ", "key"), { kind: "text", text: "sk-fake" });
  assert.deepEqual(typedSecret('{\n "a": 1\n}', "secret"), { kind: "file", filename: "secret", content: encodeText('{\n "a": 1\n}') });
  assert.equal(typedSecret("  ", "key"), null);
  assert.equal(valueText({ kind: "file", filename: "k", content: encodeText("héllo\nthere") }), "héllo\nthere");
  assert.equal(valueText({ kind: "file", filename: "k", content: "/w==" }), null, "bytes that are not text have none to show");
});

test("a field is told by its role, or by its name as it was given", () => {
  assert.equal(labelOf("username", "username", en), "Username");
  assert.equal(labelOf("password", "password", en), "Password");
  assert.equal(labelOf("key", null, en), "API key");
  assert.equal(labelOf("account id", null, en), "Account id");
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
  assert.equal(usesSummary(entry([]), names, en), "Not used yet");
  assert.equal(usesSummary(entry([server]), names, en), "OpenAI models");
  assert.equal(usesSummary(entry([env]), names, en), "Amuse's computer: $CF_API_TOKEN");
  assert.equal(usesSummary(entry([env, server]), names, en), "Amuse's computer: $CF_API_TOKEN · OpenAI models");
  assert.equal(useSentence(env, names, en), "Commands on Amuse's computer can use $CF_API_TOKEN");
  assert.equal(useSentence(file, names, en), "Saved on Amuse's computer as .config/x/key.json");
  assert.equal(useSentence(env, names, zhCN), "Amuse 的电脑上的命令可以用 $CF_API_TOKEN");
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

test("the Vault's screens read a secret only through secrets.reveal, and copy only in the one helper", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const folder = new URL("./components/", import.meta.url);
  const screens = readdirSync(folder).filter((name) => /^Secret.*\.tsx$/.test(name));
  assert.ok(screens.length >= 4);
  for (const name of screens) {
    const source = readFileSync(new URL(name, folder), "utf8");
    assert.doesNotMatch(source, /navigator\.clipboard|writeText|execCommand\(["']copy/i, `${name} copies without the helper`);
    assert.doesNotMatch(source, /localStorage|sessionStorage/, `${name} keeps something in the browser`);
  }
  const page = readFileSync(new URL("SecretEntryPage.tsx", folder), "utf8");
  assert.match(page, /"secrets\.reveal"/);
  // an edit starts from empty boxes for the secrets: what is typed replaces, nothing is shown back
  assert.match(page, /secret\.get\(field\.name\) \?\? ""/);
  // a secret's box is dots
  assert.match(readFileSync(new URL("SecretFields.tsx", folder), "utf8"), /hidden \? "password" : "text"/);
});

test("a revealed secret hides again after 30 seconds, and a copied one leaves the clipboard after 60", async () => {
  const { REVEAL_MS, CLIPBOARD_MS } = await import("./secrets.ts");
  assert.equal(REVEAL_MS, 30_000);
  assert.equal(CLIPBOARD_MS, 60_000);
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

test("copying a secret empties the clipboard later if it still holds it, and leaves another thing copied since", async () => {
  const { copy } = await import("./secrets.ts");
  let held = "";
  const clipboard = { writeText: async (text: string) => void (held = text), readText: async () => held };
  Object.defineProperty(globalThis, "navigator", { value: { clipboard }, configurable: true });
  await copy("sk-fake-copied", 5);
  assert.equal(held, "sk-fake-copied");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(held, "", "cleared");
  await copy("sk-fake-again", 5);
  held = "something else";
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(held, "something else", "not the user's later copy");
  await copy("plain value", null);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(held, "plain value", "a plain value is left");
});
