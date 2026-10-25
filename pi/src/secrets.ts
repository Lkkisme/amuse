/**
 * The agent and the Vault. It sees what is kept but never a secret's value (`list_secrets`: names, plain
 * values, the names of secret fields, uses); it asks the user for one on a card (`request_secret`: a temporary code
 * for a terminal, a long-term secret to keep, or the key of one of Amuse's own services); and it puts a field to
 * use in the sandbox (`use_secret`), which for a secret field's first use there waits for the user's OK on a card.
 * The chat agent and its helpers have these.
 */
import { type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import { type AgentIO, type AgentSecrets, type Keys, SANDBOX_HOME, checkUse, describeUse, describe } from "@amuse/core";
import { EnvName, FieldValue, MAX_TEXT, type AskedPlain, type AskedSecret, type SecretEntry, type UseInput, fileSize } from "@amuse/protocol";
import { PaneId } from "@amuse/sandbox";
import { Type } from "typebox";
import type { Hold } from "./runs.ts";
import { status } from "./status.ts";
import { untrusted } from "./untrusted.ts";

type Result = { content: { type: "text"; text: string }[]; details: null };
const say = (text: string): Result => ({ content: [{ type: "text", text }], details: null });

/** What the tools work with: the store, the keys (to ask for one of Amuse's own), and whether there is a sandbox. */
export interface SecretAccess {
  secrets: AgentSecrets;
  keys?: Pick<Keys, "list"> | undefined;
  sandbox: boolean;
}

/** A use as the agent writes it. */
interface UseArgs {
  field: string;
  env?: string | undefined;
  file?: string | undefined;
  path_env?: string | undefined;
}

function useOf({ field, env, file, path_env }: UseArgs): UseInput | string {
  const named = (name: string) => (EnvName.safeParse(name).success ? name : null);
  if (path_env !== undefined && path_env.trim() !== "" && !named(path_env.trim())) return `${path_env} is not a variable's name (UPPER_CASE letters, digits and _).`;
  if (file !== undefined && file.trim() !== "") return { kind: "file", field, path: file.trim(), env: path_env?.trim() ? path_env.trim() : null };
  if (env !== undefined && env.trim() !== "") {
    const name = named(env.trim());
    return name ? { kind: "env", field, name } : `${env} is not a variable's name (UPPER_CASE letters, digits and _).`;
  }
  return `Say where ${field} goes: \`env\` (a variable) or \`file\` (a path in the sandbox's home folder).`;
}

/** The store as the agent reads it: names, plain values, the names of secret fields, uses. Never a secret's value (the listing has none). */
export function listing(entries: readonly SecretEntry[]): string {
  if (entries.length === 0) return "The Vault is empty.";
  return entries
    .map((entry) => {
      const plain = entry.plain.map((f) => `    ${f.name} = ${f.value.kind === "text" ? f.value.text : `a file, ${f.value.filename} (${fileSize(f.value.content)} bytes)`}`);
      const secret = entry.secret.map((f) => `    ${f.name}${f.kind === "file" ? ` (a file${f.filename ? `, ${f.filename}` : ""})` : ""}`);
      const uses = entry.uses.map((u) => `    ${u.kind === "server" ? `for Amuse's own use, never in the sandbox: ${describeUse(u)}` : `${describeUse(u)} (${u.field})`}`);
      return [
        `- ${entry.name}${entry.managed ? " (a sign-in, kept by Amuse)" : ""}`,
        ...(entry.note ? [`  note: ${entry.note}`] : []),
        ...(plain.length > 0 ? ["  plain fields:", ...plain] : []),
        "  secret fields (you never see their values):",
        ...secret,
        ...(uses.length > 0 ? ["  uses:", ...uses] : ["  uses: none"]),
      ].join("\n");
    })
    .join("\n");
}

/** What each tool does and says, apart from how it is declared (so it can be tried without a model). */
export function secretActions(access: SecretAccess, io: () => AgentIO, hold?: Hold) {
  const { secrets } = access;

  /** `ref` as an entry's name (or its id). */
  const entryOf = (entries: readonly SecretEntry[], ref: string) => entries.find((e) => e.id === ref) ?? entries.find((e) => e.name.trim().toLowerCase() === ref.trim().toLowerCase());

  const ask = (action: Parameters<AgentIO["act"]>[0], then: string): string => {
    const asked = io().act(action);
    return asked.ok ? then : `Not asked: ${describe(asked.rejection)}.`;
  };

  return {
    list: async () => untrusted(listing(await secrets.list())),

    async request(args: {
      name?: string | undefined;
      why: string;
      pane?: string | undefined;
      provider?: string | undefined;
      plain?: { name: string; value: string }[] | undefined;
      secret?: { name: string; kind?: "text" | "file" | undefined }[] | undefined;
      note?: string | undefined;
      uses?: UseArgs[] | undefined;
    }): Promise<string> {
      const why = args.why.trim();
      const modes = [args.pane !== undefined, args.provider !== undefined, args.secret !== undefined].filter(Boolean).length;
      if (modes !== 1) return "Not asked: give `pane` (a temporary code for a terminal), `provider` (the key of one of Amuse's own services) or `secret` (a long-term secret to keep): exactly one.";

      if (args.provider !== undefined) {
        if (!access.keys) return "Not asked: keys cannot be added from here.";
        const providers = (await access.keys.list()).providers;
        const found = providers.find((p) => p.id === args.provider);
        if (!found) return `Not asked: ${args.provider} is not a provider or app that takes a key. The ids are: ${providers.map((p) => p.id).join(", ")}.`;
        if (found.connected) return `Nothing asked: the key of ${found.name} is set up already.`;
        return ask(
          { kind: "askSecret", name: found.name, why, deliver: { kind: "key", provider: found.id, hint: null } },
          `Asked on a card. The user adds the key of ${found.name} there, through the same sign-in as in Settings; you never see it. You will hear when it is added; if they dismiss the card you hear nothing, so do not ask again unless they bring it up. Tell them in a line what it is for.`,
        );
      }

      const name = args.name?.trim() ?? "";
      if (!name) return "Not asked: say what it is, as the user knows it (`name`).";

      if (args.pane !== undefined) {
        if (!access.sandbox) return "Not asked: there is no sandbox here.";
        if (!PaneId.safeParse(args.pane).success) return `Not asked: ${args.pane} is not a pane's id (like w1:p2; herdr pane list shows them).`;
        return ask(
          { kind: "askSecret", name, why, deliver: { kind: "temporary", pane: args.pane } },
          "Asked on a card. They type the code and it goes straight into that terminal, with Enter; it is not kept anywhere. You will hear when they provide it or decline; you never see it. Tell them in a line what it is for.",
        );
      }

      // a long-term secret
      const secret = args.secret ?? [];
      if (secret.length === 0) return "Not asked: a long-term secret needs at least one secret field (`secret`).";
      const entries = await secrets.list();
      if (entryOf(entries, name)) return `Not asked: there is an entry called ${name} already. Look with list_secrets; to put one of its fields to use, use_secret.`;
      // the plain fields are yours to fill in: the user types secrets only, on the card
      const plainAsked: AskedPlain[] = [];
      for (const f of args.plain ?? []) {
        const value = FieldValue.safeParse({ kind: "text", text: f.value.trim() });
        if (!value.success) return `Not asked: the value of ${f.name} is a line of text (not empty, no line breaks, at most ${MAX_TEXT} characters).`;
        plainAsked.push({ name: f.name.trim(), role: null, value: value.data });
      }
      const secretAsked: AskedSecret[] = secret.map((f) => ({ name: f.name.trim(), kind: f.kind ?? "text", role: null }));
      const all = [...plainAsked, ...secretAsked].map((f) => f.name.toLowerCase());
      if (all.some((n) => n === "") || new Set(all).size !== all.length) return "Not asked: every field has a name of its own.";
      const uses: UseInput[] = [];
      for (const u of args.uses ?? []) {
        const use = useOf(u);
        if (typeof use === "string") return `Not asked: ${use}`;
        uses.push(use);
      }
      if (uses.length > 0 && !access.sandbox) return "Not asked: there is no sandbox here, so nothing can be put in it.";
      // the uses are tried on the entry as it will be, so a variable that is taken is said now, with by whom
      let trial: SecretEntry = {
        id: "trial",
        name,
        managed: false,
        plain: plainAsked.map((f) => ({ name: f.name, role: null, value: f.value })),
        secret: secretAsked.map((f) => ({ name: f.name, role: null, kind: f.kind, filename: null, size: 0, hint: null, last: null })),
        note: "",
        uses: [],
        created: "",
      };
      for (const use of uses) {
        const checked = checkUse([...entries, trial], "trial", use, SANDBOX_HOME);
        if (!checked.ok) return `Not asked: ${checked.reason}`;
        trial = { ...trial, uses: [...trial.uses, { ...checked.use, id: `trial-${trial.uses.length}` }] };
      }
      return ask(
        { kind: "askSecret", name, why, deliver: { kind: "stored", plain: plainAsked, secret: secretAsked, note: (args.note ?? "").trim(), uses } },
        "Asked on a card. They type only the secret fields (what they type is kept encrypted, and you never see it); the plain fields you gave are shown read-only. It is saved to the Vault and set up as written on the card. You will hear when they provide it or decline; you never see the secret fields' values, and the sandbox's output shows them masked. Tell them in a line what it is for.",
      );
    },

    async use(args: { entry: string; why: string } & UseArgs): Promise<string> {
      if (!access.sandbox) return "Not done: there is no sandbox here.";
      const entries = await secrets.list();
      const entry = entryOf(entries, args.entry);
      if (!entry) return `Not done: there is no entry called ${args.entry}. Look with list_secrets.`;
      const use = useOf(args);
      if (typeof use === "string") return `Not done: ${use}`;
      const checked = checkUse(entries, entry.id, use, SANDBOX_HOME);
      if (!checked.ok) return `Not done: ${checked.reason}`;
      const params = { id: entry.id, use: checked.use };
      const where = describeUse(checked.use);
      if (!checked.needsCard) {
        try {
          await secrets.useByAgent(params, false);
        } catch (error) {
          return `Not done: ${error instanceof Error ? error.message : "it could not be done"}.`;
        }
        return `Done: ${entry.name} ${args.field} is in the sandbox as ${where}.`;
      }
      // a secret field's first time in the sandbox: what runs there can read it, and cannot be stopped, so the user decides
      const card = io().act({
        kind: "ask",
        action: "Put a secret in the sandbox",
        target: `${entry.name}, ${args.field}`,
        detail: [
          args.why.trim(),
          `Amuse wants to put it in the sandbox as ${where}.`,
          "Programs in the sandbox, Amuse included, can read it. You can take it out again in Settings › Vault.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        remember: false,
        lasting: true,
      });
      if (!card.ok) return `Not done: could not ask the user (${describe(card.rejection)}).`;
      const apply = async (): Promise<string> => {
        try {
          await secrets.useByAgent(params, true);
          return `Done: ${entry.name} ${args.field} is in the sandbox as ${where}.`;
        } catch (error) {
          return `Not done: ${error instanceof Error ? error.message : "it could not be done"}.`;
        }
      };
      if (hold) {
        // a helper holds here until the user answers, then goes on with the result
        hold.waiting(`to put ${entry.name} ${args.field} in the sandbox`);
        const { verdict } = await io().decision(card.id);
        hold.working();
        if (verdict !== "approved") return `Not done: the user ${verdict === "denied" ? "declined it" : "did not answer in time"}. Do not try another way.`;
        return apply();
      }
      // the chat never holds for an approval: ask, return, finish in the background
      const agent = io();
      void agent.decision(card.id).then(async ({ verdict }) => {
        if (verdict === "denied") return agent.report(`[secret] The user did not allow ${entry.name} ${args.field} into the sandbox. Do not try another way.`);
        if (verdict === "timed_out") return agent.report(`[secret] ${entry.name} ${args.field} was not put in the sandbox: the user did not answer in time.`);
        agent.report(`[secret] ${await apply()}`);
      });
      return `NOT done yet: it waits for the user's OK on the card in the chat. Tell them it waits for their OK; do not say it is done. You get a report once it is.`;
    },
  };
}

const field = Type.Object({
  name: Type.String({ description: "The field's name, e.g. 'token', 'account id', 'key.json'" }),
  kind: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("file")], { description: "text (a line, the default) or file (a JSON key file, a keystore: the user uploads it; at most 64 KB)" })),
});
const use = Type.Object({
  field: Type.String({ description: "Which field goes there (its name)" }),
  env: Type.Optional(Type.String({ description: "A sandbox variable (UPPER_CASE) that holds the field's value" })),
  file: Type.Optional(Type.String({ description: "Or a path in the sandbox's home folder (not the workspace) that the field is written to" })),
  path_env: Type.Optional(Type.String({ description: "With `file`: a variable that holds the file's path (e.g. GOOGLE_APPLICATION_CREDENTIALS)" })),
});

/** The Vault's tools for the chat agent and its helpers. */
export function secretTools(io: () => AgentIO, access: SecretAccess, hold?: Hold): ToolDefinition[] {
  const act = secretActions(access, io, hold);
  return [
    defineTool({
      name: "list_secrets",
      label: "Looking at the Vault",
      description:
        "What the Vault keeps: each entry's name and note, its plain fields (account ids, usernames, regions: you see their values), the NAMES of its secret fields (never their values) and where each is used (a sandbox variable or file, or one of Amuse's own services). Look here before you ask the user for a key or a token: it may be kept already, and you only need to put it to use.",
      parameters: Type.Object({ status }),
      async execute() {
        return say(await act.list());
      },
    }),
    defineTool({
      name: "request_secret",
      label: "Asking for a secret",
      description:
        "Ask the user for a secret on a card. They type it there; it never comes to you or the chat. Check list_secrets first. Three kinds, exactly one per call:\n" +
        "- A TEMPORARY code a program waits for (a login code, a verification code, an OAuth code, or a password a program prompts for now: sudo, ssh, a database shell): give `pane` (the herdr terminal's id, like w1:p2 or wC:p1) and `name`. Start the program in that terminal first, so it is waiting at its prompt. It is typed into that terminal with Enter and kept nowhere: it is not stored, listed or tracked. A password for one prompt is temporary; keep one in the Vault only when the user wants it kept or your work needs it again and again.\n" +
        "- A LONG-TERM secret (an API key, a token, a password, a key file): give `name`, `secret` (its secret fields, at least one: usually one called 'token' or 'key'), `plain` (the fields that are not secret, WITH their values, which you fill in: an account id, a username, a region; what you do not know, ask the user in the chat first, and never put a password, key, token or code there: it is shown on the card, and you can read it), an optional `note` (plain text for the user and you, never a secret), and `uses` (where it goes: `env` a sandbox variable, or `file` a path in the sandbox's home folder, optionally with `path_env`, a variable holding the file's path). The user types only the secret fields on the card (everything they type there is kept encrypted, and you never see it); it is saved to the Vault, and the uses are set up when they do. A key file (a Google service account's JSON) is a secret field with kind 'file', with a use writing it to a file and `path_env` set. Never ask for a secret in the chat.\n" +
        "- The key of one of Amuse's OWN services (a model provider, Composio for connections): give `provider` (its id, e.g. 'openai', 'composio'). The card opens the same sign-in as Settings. Use this, not a pointer to Settings, when your work needs a provider or Composio key that is not set up. It reaches neither you nor the sandbox.",
      parameters: Type.Object({
        status,
        name: Type.Optional(Type.String({ description: "What it is, as the user knows it, e.g. 'Cloudflare', 'Claude login code' (not needed with `provider`)" })),
        why: Type.String({ description: "What it is for, in the user's language" }),
        pane: Type.Optional(Type.String({ description: "A temporary code: the terminal's pane id, like w1:p2" })),
        provider: Type.Optional(Type.String({ description: "The key of one of Amuse's own services: the provider's id (e.g. openai, openrouter) or composio" })),
        secret: Type.Optional(Type.Array(field, { description: "A long-term secret: its secret fields (at least one)" })),
        plain: Type.Optional(
          Type.Array(
            Type.Object({
              name: Type.String({ description: "The field's name, e.g. 'username', 'account id', 'region'" }),
              value: Type.String({ description: "Its value, which you fill in: what you know, or have asked the user in the chat. One line." }),
            }),
            { description: "Its plain fields, with their values: you supply these. The card shows them to the user read-only, and you may see them afterwards." },
          ),
        ),
        note: Type.Optional(Type.String({ description: "Plain text about it, e.g. 'DNS edit only, example.com'. Never a secret." })),
        uses: Type.Optional(Type.Array(use, { description: "Where its fields go in the sandbox" })),
      }),
      async execute(_, args) {
        return say(await act.request(args));
      },
    }),
    defineTool({
      name: "use_secret",
      label: "Putting a secret to use",
      description:
        "Put a field of an entry in the Vault to use in the sandbox: as a variable (`env`) or a file (`file`, with `path_env` for a variable that holds its path). A plain field, or a secret field that is in the sandbox already (a second name for it), is done at once. A secret field's FIRST time in the sandbox waits for the user's OK on a card (programs there, you included, can read it): tell them what it wants and why; you hear the answer. The field is the name of one of its fields (see list_secrets).",
      parameters: Type.Object({
        status,
        entry: Type.String({ description: "The entry's name (or id)" }),
        field: Type.String({ description: "The field's name: a plain field or a secret field" }),
        why: Type.String({ description: "What it is for, in the user's language" }),
        env: Type.Optional(Type.String({ description: "A sandbox variable (UPPER_CASE)" })),
        file: Type.Optional(Type.String({ description: "Or a path in the sandbox's home folder" })),
        path_env: Type.Optional(Type.String({ description: "With `file`: a variable that holds the file's path" })),
      }),
      async execute(_, args) {
        return say(await act.use(args));
      },
    }),
  ];
}
