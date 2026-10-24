/**
 * The demo's Vault: in memory, with made-up entries so the screens have something to show. A value typed here
 * is forgotten at once (only its end is kept, for the hint), and nothing goes anywhere.
 */
import { type Secrets, Rejected, SANDBOX_HOME, checkUse, hintOf, newId } from "@amuse/core";
import type { FieldValue, SecretEntry, SecretField, SecretInput, Use } from "@amuse/protocol";

const unsound = (reason: string) => new Rejected({ kind: "unsound", reason });

const hour = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const fieldOf = (input: SecretInput): SecretField => ({
  name: input.name,
  role: input.role,
  kind: input.value.kind,
  filename: input.value.kind === "file" ? input.value.filename : null,
  size: input.value.kind === "file" ? input.value.content.length : input.value.text.length,
  hint: input.value.kind === "text" ? hintOf(input.value.text) : null,
  last: null,
});

const text = (value: string): FieldValue => ({ kind: "text", text: value });

function seeded(): SecretEntry[] {
  return [
    {
      id: "e-demo-cloudflare",
      name: "Cloudflare",
      managed: false,
      plain: [{ name: "account id", role: null, value: text("a1b2c3d4e5f6") }],
      secret: [{ name: "token", role: null, kind: "text", filename: null, size: 40, hint: "…demo", last: { at: ago(2 * hour), how: "sandbox", what: "$CF_API_TOKEN" } }],
      note: "DNS edit only, example.com",
      uses: [{ id: "u-demo-1", kind: "env", field: "token", name: "CF_API_TOKEN" }],
      created: ago(72 * hour),
    },
    {
      id: "e-demo-gcp",
      name: "Google Cloud",
      managed: false,
      plain: [{ name: "project id", role: null, value: text("demo-project-123") }],
      secret: [{ name: "key.json", role: null, kind: "file", filename: "service-account.json", size: 2380, hint: null, last: null }],
      note: "",
      uses: [{ id: "u-demo-2", kind: "file", field: "key.json", path: ".config/gcloud/key.json", env: "GOOGLE_APPLICATION_CREDENTIALS" }],
      created: ago(48 * hour),
    },
    {
      id: "e-demo-login",
      name: "Campus portal",
      managed: false,
      plain: [{ name: "username", role: "username", value: text("alex") }],
      secret: [{ name: "password", role: "password", kind: "text", filename: null, size: 14, hint: "…demo", last: null }],
      note: "",
      uses: [],
      created: ago(24 * hour),
    },
  ];
}

export function memorySecrets(): Secrets {
  let entries = seeded();
  const find = (id: string): SecretEntry => {
    const found = entries.find((e) => e.id === id);
    if (!found) throw unsound("That entry is not there any more.");
    return found;
  };
  const change = (id: string, make: (entry: SecretEntry) => SecretEntry) => {
    entries = entries.map((e) => (e.id === id ? make(e) : e));
  };
  const addUse = (id: string, input: Parameters<Secrets["use"]>[0]["use"]): Use => {
    const checked = checkUse(entries, id, input, SANDBOX_HOME);
    if (!checked.ok) throw unsound(checked.reason);
    const use: Use = { ...checked.use, id: newId("u") };
    change(id, (e) => ({ ...e, uses: [...e.uses, use] }));
    return use;
  };
  return {
    list: async () => entries,
    async add(p) {
      const name = p.name.trim();
      if (entries.some((e) => e.name.toLowerCase() === name.toLowerCase())) throw unsound(`There is already an entry called ${name}.`);
      const id = newId("e");
      entries = [...entries, { id, name, managed: false, plain: p.plain.map(({ name: n, role, value }) => ({ name: n, role, value })), secret: p.secret.map(fieldOf), note: p.note, uses: [], created: new Date().toISOString() }];
      for (const use of p.uses) addUse(id, use);
      return { id };
    },
    async edit({ id, name, note, plain }) {
      find(id);
      change(id, (e) => ({ ...e, name: name.trim(), note, plain: plain.map(({ name: n, role, value }) => ({ name: n, role, value })) }));
    },
    async setSecret({ id, field }) {
      const entry = find(id);
      const next = fieldOf(field);
      change(id, (e) => ({ ...e, secret: entry.secret.some((f) => f.name === field.name) ? e.secret.map((f) => (f.name === field.name ? { ...next, last: f.last } : f)) : [...e.secret, next] }));
    },
    async reveal() {
      throw unsound("The demo keeps no secret to show.");
    },
    async removeSecret({ id, name }) {
      const entry = find(id);
      if (entry.secret.length === 1) throw unsound(`${entry.name} needs a secret: remove the entry instead.`);
      change(id, (e) => ({ ...e, secret: e.secret.filter((f) => f.name !== name), uses: e.uses.filter((u) => u.field !== name) }));
    },
    use: async ({ id, use }) => addUse(id, use),
    useByAgent: async ({ id, use }) => addUse(id, use),
    async unuse({ id, use }) {
      change(id, (e) => ({ ...e, uses: e.uses.filter((u) => u.id !== use) }));
    },
    async remove(id) {
      find(id);
      entries = entries.filter((e) => e.id !== id);
    },
    // nothing is kept: the demo's agent asks for nothing
    answer: async () => {},
  };
}
