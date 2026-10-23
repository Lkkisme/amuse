/**
 * The Vault (protocol/src/secrets.ts says what it holds; core/src/secrets.ts has the rules): kept in the server's database
 * (the `secrets` tables, db/migrations), with every secret field's value sealed (seal.ts) and the key apart from the data.
 * Plain fields are in the tables as they are.
 *
 * The entries are held in memory as well, and each change is written to the tables in one database transaction (which is a
 * savepoint when a caller has one open). Uses put a field where it goes. A sandbox use gives the value to the sandbox's
 * daemon (a variable or a file), which keeps it for the user alone and is given everything again after a reset (`again`); a
 * use for a service of the server's is read from here when the service needs it (`serviceKey`) and goes nowhere else. A
 * change is done in the sandbox first and written down after, and what the sandbox already has is taken back if a step
 * fails, so a failure leaves the Vault as it was. Everything the sandbox says to the agent comes back with the secrets that
 * are in it masked (`masked`, and @amuse/sandbox's `masking`).
 *
 * Nothing here logs or returns a secret's value, but to the sandbox, and to the server's own service that asked.
 */
import { type Db, query, queryOne, transaction } from "@amuse/db";
import {
  type Masking,
  type Secrets,
  type ServiceStore,
  Rejected,
  SANDBOX_HOME,
  checkUse,
  claimsOf,
  describeUse,
  hintOf,
  inSandbox,
  labelOf,
  maskings,
  newId,
  pathInHome,
} from "@amuse/core";
import {
  FieldKind,
  type LastUsed,
  type PlainField,
  PlainRole,
  type PlainInput,
  type SecretAnswer,
  type SecretEntry,
  type SecretField,
  SecretRole,
  type SecretInput,
  type SecretRequest,
  Use,
  type UseInput,
  type FieldValue,
} from "@amuse/protocol";
import { SandboxError, type SandboxClient } from "@amuse/sandbox";
import { z } from "zod";
import { KeyUnavailable, type Seal, Unsealable, fileKey, sealer } from "./seal.ts";

/** A secret field as it is kept: what may be shown, and the value sealed to this entry and field (seal.ts). */
interface Sealed {
  name: string;
  role: SecretField["role"];
  kind: SecretField["kind"];
  filename: string | null;
  size: number;
  hint: string | null;
  sealed: string;
  last: LastUsed | null;
}

interface Kept {
  id: string;
  name: string;
  managed: boolean;
  note: string;
  created: string;
  plain: PlainField[];
  secret: Sealed[];
  uses: Use[];
}

const CHECK_VALUE = new TextEncoder().encode("amuse secret store");
const CHECK_ENTRY = "store";
const CHECK_FIELD = "check";

const Rows = {
  entry: z.object({ id: z.string(), name: z.string(), managed: z.number(), note: z.string(), created: z.string() }),
  plain: z.object({ entry: z.string(), name: z.string(), role: PlainRole.nullable(), kind: FieldKind, value: z.string(), filename: z.string().nullable() }),
  field: z.object({
    entry: z.string(),
    name: z.string(),
    role: SecretRole.nullable(),
    kind: FieldKind,
    filename: z.string().nullable(),
    size: z.number(),
    hint: z.string().nullable(),
    sealed: z.string(),
    last_at: z.string().nullable(),
    last_how: z.enum(["sandbox", "server"]).nullable(),
    last_what: z.string().nullable(),
  }),
  use: z.object({
    id: z.string(),
    entry: z.string(),
    field: z.string(),
    kind: z.enum(["env", "file", "server"]),
    name: z.string().nullable(),
    path: z.string().nullable(),
    env: z.string().nullable(),
    service: z.string().nullable(),
    target: z.string().nullable(),
  }),
};

/** A use as its row says it, read back into the shape the protocol has (a row that is not one is an error). */
function useOfRow(row: z.infer<typeof Rows.use>): Use {
  const parsed = Use.safeParse(
    row.kind === "env"
      ? { id: row.id, kind: "env", field: row.field, name: row.name }
      : row.kind === "file"
        ? { id: row.id, kind: "file", field: row.field, path: row.path, env: row.env }
        : { id: row.id, kind: "server", field: row.field, service: row.service, target: row.target },
  );
  if (!parsed.success) throw new Error("A use in the Vault's tables is not one.");
  return parsed.data;
}

/** Every entry in the tables, in the order they were made. */
function loadEntries(db: Db): Kept[] {
  const plain = query(db, Rows.plain, "select entry, name, role, kind, value, filename from secret_plain order by entry, position");
  const fields = query(db, Rows.field, "select entry, name, role, kind, filename, size, hint, sealed, last_at, last_how, last_what from secret_fields order by entry, position");
  const uses = query(db, Rows.use, "select id, entry, field, kind, name, path, env, service, target from secret_uses order by entry, position");
  return query(db, Rows.entry, "select id, name, managed, note, created from secrets order by created, id").map((row) => ({
    id: row.id,
    name: row.name,
    managed: row.managed === 1,
    note: row.note,
    created: row.created,
    plain: plain
      .filter((p) => p.entry === row.id)
      .map((p): PlainField => ({ name: p.name, role: p.role, value: p.kind === "text" ? { kind: "text", text: p.value } : { kind: "file", filename: p.filename ?? "file", content: p.value } })),
    secret: fields
      .filter((f) => f.entry === row.id)
      .map((f): Sealed => ({
        name: f.name,
        role: f.role,
        kind: f.kind,
        filename: f.filename,
        size: f.size,
        hint: f.hint,
        sealed: f.sealed,
        last: f.last_at !== null && f.last_how !== null && f.last_what !== null ? { at: f.last_at, how: f.last_how, what: f.last_what } : null,
      })),
    uses: uses.filter((u) => u.entry === row.id).map(useOfRow),
  }));
}

/** An entry written to the tables, whole: what was there of it goes first (its fields and uses with it). */
function saveEntry(db: Db, e: Kept): void {
  db.prepare("delete from secrets where id = ?").run(e.id);
  db.prepare("insert into secrets (id, name, managed, note, created) values (?, ?, ?, ?, ?)").run(e.id, e.name, e.managed ? 1 : 0, e.note, e.created);
  e.plain.forEach((f, position) =>
    db
      .prepare("insert into secret_plain (entry, position, name, role, kind, value, filename) values (?, ?, ?, ?, ?, ?, ?)")
      .run(e.id, position, f.name, f.role, f.value.kind, f.value.kind === "text" ? f.value.text : f.value.content, f.value.kind === "file" ? f.value.filename : null),
  );
  e.secret.forEach((f, position) =>
    db
      .prepare("insert into secret_fields (entry, position, name, role, kind, filename, size, hint, sealed, last_at, last_how, last_what) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(e.id, position, f.name, f.role, f.kind, f.filename, f.size, f.hint, f.sealed, f.last?.at ?? null, f.last?.how ?? null, f.last?.what ?? null),
  );
  e.uses.forEach((u, position) => {
    db
      .prepare("insert into secret_uses (id, entry, position, field, kind, name, path, env, service, target) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        u.id,
        e.id,
        position,
        u.field,
        u.kind,
        u.kind === "env" ? u.name : null,
        u.kind === "file" ? u.path : null,
        u.kind === "file" ? u.env : null,
        u.kind === "server" ? u.service : null,
        u.kind === "server" ? u.target : null,
      );
    for (const claim of claimsOf(u)) db.prepare("insert into secret_claims (claim, use) values (?, ?)").run(claim, u.id);
  });
}

/** The most fields an entry holds on each side, and entries the store holds. */
const MOST_FIELDS = 20;
const MOST_ENTRIES = 500;
/** The longest a service's setting is. */
const MAX_LINE = 20_000;
/** A secret used again within this long of its last record is not written down again. */
const RECORD_EVERY_MS = 60_000;
/** How long a temporary code is remembered, to mask what a terminal shows of it. */
const CODE_MS = 24 * 3_600_000;

const unsound = (reason: string) => new Rejected({ kind: "unsound", reason });
/** What the sandbox could not do, in our words (never what it said). */
const worded = (error: unknown) => (error instanceof SandboxError ? unsound(error.message) : error);

export interface SecretStore extends Secrets, ServiceStore {
  /** What to mask in all the sandbox says: secrets that are in it, and temporary codes. */
  masked(): Masking[];
  /** The entries a provider's key was kept in under its plain id ("openai"), given the name it is known by ("OpenAI"): the ones whose name is still the id. */
  relabel(names: (id: string) => string): Promise<void>;
  /** After a reset emptied the sandbox's home: its variables and files again, as far as they can be (what was waiting to be taken out is gone with the home). */
  again(): Promise<void>;
  /** When the server starts, and whenever the sandbox may be reachable again: what it could not be told to forget is taken out, and what it should hold but may not is given again. */
  sweep(): Promise<void>;
  /**
   * Entries made from what was kept before (migration), without the sandbox: the ids of those made, and those left because
   * a variable, file or service of theirs is taken (`by` has it; `same`: it is a copy of this very one, made before).
   */
  adopt(entries: Params[]): Promise<{ made: string[]; taken: { name: string; by: string; same: boolean }[] }>;
}

type Params = Parameters<Secrets["add"]>[0];

export interface StoreOptions {
  /** the server's database, with the Vault's tables */
  db: Db;
  /** the key's file, apart from the data */
  keyPath: string;
  /** without one, nothing can go into a sandbox */
  sandbox?: SandboxClient | undefined;
  now?: () => string;
  id?: (prefix: string) => string;
  /** for warnings; never given a value */
  warn?: (message: string) => void;
}

/** What a use takes for itself, to tell the same one. */
const claim = (use: UseInput | Use): string =>
  use.kind === "env" ? `env ${use.name}` : use.kind === "file" ? `file ${pathInHome(use.path, SANDBOX_HOME) ?? use.path}` : `${use.service} ${use.target}`;

/** The bytes a value stands for. */
const bytesOf = (value: FieldValue): Uint8Array => (value.kind === "text" ? new TextEncoder().encode(value.text) : Buffer.from(value.content, "base64"));

export function secretStore({ db, keyPath, sandbox, now = () => new Date().toISOString(), id = newId, warn = console.warn }: StoreOptions): SecretStore {
  let entries: Kept[] = loadEntries(db);
  const check = queryOne(db, z.object({ sealed: z.string() }), "select sealed from vault_check")?.sealed;
  const seal: Seal = sealer(fileKey(keyPath, entries.some((e) => e.secret.length > 0) || check !== undefined));
  // a key of the right size that is not the one these secrets were sealed with is found now, not when one is wanted
  const opens = (sealed: string, entry: string, field: string): boolean => {
    try {
      seal.open(sealed, entry, field);
      return true;
    } catch (error) {
      if (error instanceof Unsealable) return false;
      throw error;
    }
  };
  const first = entries.flatMap((e) => e.secret.map((f) => ({ entry: e.id, field: f.name, sealed: f.sealed })))[0];
  const probe = check !== undefined ? { entry: CHECK_ENTRY, field: CHECK_FIELD, sealed: check } : first;
  if (probe && !opens(probe.sealed, probe.entry, probe.field))
    throw new KeyUnavailable(
      `The Vault's key file (${keyPath}) is not the key its secrets were sealed with. Restore the right file from your backup; the Vault is not opened with this one, and nothing is changed.`,
      "wrong",
    );
  // a Vault with no check value has one from now on
  if (check === undefined) db.prepare("insert into vault_check (id, sealed) values (1, ?)").run(seal.seal(CHECK_VALUE, CHECK_ENTRY, CHECK_FIELD));
  /** The tables made to say `next`: the entries that changed written, the ones gone deleted, all in one transaction. */
  const persist = (next: Kept[]) =>
    transaction(db, () => {
      const before = new Map(entries.map((e) => [e.id, JSON.stringify(e)]));
      const kept = new Set(next.map((e) => e.id));
      for (const e of entries) if (!kept.has(e.id)) db.prepare("delete from secrets where id = ?").run(e.id);
      for (const e of next) if (before.get(e.id) !== JSON.stringify(e)) saveEntry(db, e);
    });

  let queue: Promise<unknown> = Promise.resolve();
  /** run `step` after every change before it */
  const serial = <T>(step: () => Promise<T>): Promise<T> => {
    const next = queue.then(step);
    queue = next.catch(() => {});
    return next;
  };

  /** What masks what the sandbox says, worked out again after any change. */
  let masks: Masking[] | undefined;
  const codes = new Map<string, number>();
  /** What is being given to the sandbox right now: masked from before the first of it goes, until the change is done (or undone). */
  const inflight = new Set<Masking[]>();
  /**
   * What was in the sandbox and is not any more, as far as the Vault is concerned (a secret replaced or removed): still masked until
   * the sandbox's home is emptied, since a program may have kept it (a file it wrote, a terminal's history) and print it later.
   */
  const retired: Masking[] = [];
  const retire = (masks: Masking[]) => {
    for (const mask of masks) if (!retired.some((r) => r.value === mask.value && r.name === mask.name)) retired.push(mask);
  };
  /** The sandbox could not be reached to give things back or to take them out: the Vault gives everything again, and takes out what was left, next time it can. */
  let stale = false;
  const commit = (next: Kept[]) => {
    persist(next);
    entries = next;
    masks = undefined;
  };

  const view = (e: Kept): SecretEntry => ({
    id: e.id,
    name: e.name,
    managed: e.managed,
    plain: e.plain,
    secret: e.secret.map(({ sealed: _, ...field }) => field),
    note: e.note,
    uses: e.uses,
    created: e.created,
  });
  const views = (all: readonly Kept[] = entries) => all.map(view);

  const find = (all: readonly Kept[], entryId: string): Kept => {
    const found = all.find((e) => e.id === entryId);
    if (!found) throw unsound("That entry is not there any more.");
    return found;
  };
  /** An entry the user may change: not one the system keeps (a sign-in), which can only be removed. */
  const yours = (all: readonly Kept[], entryId: string): Kept => {
    const found = find(all, entryId);
    if (found.managed) throw unsound(`${found.name} is kept by Amuse (it is a sign-in): it can be removed, which signs out, but not changed.`);
    return found;
  };
  const replace = (all: readonly Kept[], next: Kept): Kept[] => all.map((e) => (e.id === next.id ? next : e));

  /** A field's bytes, opened or as they are. */
  const bytes = (e: Kept, name: string): Uint8Array => {
    const plain = e.plain.find((f) => f.name === name);
    if (plain) return bytesOf(plain.value);
    const secret = e.secret.find((f) => f.name === name);
    if (!secret) throw unsound(`${e.name} has no field called ${name}.`);
    try {
      return seal.open(secret.sealed, e.id, secret.name);
    } catch (error) {
      if (error instanceof Unsealable) throw unsound(`${e.name} ${name} could not be opened: ${error.message}`);
      throw error;
    }
  };
  /** A field as a line of text, for a variable or a service. */
  const textOf = (e: Kept, name: string): string => {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes(e, name));
    } catch (error) {
      if (error instanceof Rejected) throw error;
      throw unsound(`${e.name} ${name} is not text, so it cannot be put in a variable: use it as a file.`);
    }
  };

  const sandboxOf = (): SandboxClient => {
    if (!sandbox) throw unsound("This server has no sandbox.");
    return sandbox;
  };
  const relative = (use: Extract<Use, { kind: "file" }>): string => {
    const inside = pathInHome(use.path, SANDBOX_HOME);
    if (inside === null) throw unsound(`${use.path} is not a file in the sandbox's home folder.`);
    return inside;
  };

  /** Put a use's field where it goes in the sandbox. */
  const put = async (e: Kept, use: Use): Promise<void> => {
    if (!inSandbox(use)) return;
    try {
      if (use.kind === "env") await sandboxOf().setEnv({ name: use.name, value: textOf(e, use.field) });
      else if (use.kind === "file") {
        const inside = relative(use);
        await sandboxOf().setFile({ path: inside, value: Buffer.from(bytes(e, use.field)).toString("base64"), encoding: "base64" });
        if (use.env) await sandboxOf().setEnv({ name: use.env, value: `${SANDBOX_HOME}/${inside}` });
      }
    } catch (error) {
      throw worded(error);
    }
  };
  /** Every variable and file the Vault's uses say the sandbox holds, given again; false if any could not be. */
  const redeliver = async (): Promise<boolean> => {
    let all = true;
    for (const e of entries)
      for (const use of e.uses) {
        try {
          await put(e, use);
        } catch (error) {
          all = false;
          stale = true;
          warn(`${e.name} could not be given to the sandbox again (${error instanceof Error ? error.message : "an error"}).`);
        }
      }
    return all;
  };

  /** A variable or file the sandbox could not be told to forget now: written down, to be taken out when it can be reached (names only). */
  const leave = (use: Use) => {
    const rows: [string, string][] =
      use.kind === "env" ? [["env", use.name]] : use.kind === "file" ? [["file", pathInHome(use.path, SANDBOX_HOME) ?? use.path], ...(use.env ? [["env", use.env] as [string, string]] : [])] : [];
    for (const [kind, target] of rows) db.prepare("insert or ignore into sandbox_cleanup (kind, target) values (?, ?)").run(kind, target);
  };
  /**
   * Take a use's field back out of the sandbox (with no sandbox, there is nothing there to take). When the sandbox cannot be
   * reached, the removal still stands: what is to be taken out is remembered, and the caller keeps masking the value.
   */
  const take = async (use: Use): Promise<void> => {
    if (!sandbox) return;
    try {
      if (use.kind === "env") await sandboxOf().forget({ env: use.name });
      else if (use.kind === "file") {
        await sandboxOf().forget({ file: relative(use) });
        if (use.env) await sandboxOf().forget({ env: use.env });
      }
    } catch (error) {
      if (!(error instanceof SandboxError)) throw error;
      leave(use);
      warn(`The sandbox could not be told to forget ${describeUse(use)} just now (${error.message}). It is taken out the next time the sandbox is reached, and masked until then.`);
    }
  };

  /** One step of a change to the sandbox: what undoes it, then what does it. */
  type Step = (undo: () => Promise<void>, run: () => Promise<void>) => Promise<void>;
  /**
   * A change that reaches the sandbox, all or nothing. `about`: what it puts there, masked from before the first of it
   * goes, so that nothing it prints (a failing command, `env`) carries it to the agent. If a step fails, the steps
   * before it, and the failing one itself (which may have gone halfway), are undone, last first, and the failure
   * goes on to the caller: the sandbox holds what it held before.
   */
  const delivering = async <T>(about: Masking[], work: (step: Step) => Promise<T>): Promise<T> => {
    const undos: (() => Promise<void>)[] = [];
    const step: Step = async (undo, run) => {
      undos.push(undo);
      await run();
    };
    inflight.add(about);
    try {
      return await work(step);
    } catch (error) {
      // what was going out may be in the sandbox yet, so it stays masked; and if it could not all be put back, the Vault gives everything again
      retire(about);
      for (const undo of undos.reverse())
        await undo().catch(() => {
          stale = true;
        });
      if (stale) warn("A change to the sandbox failed halfway, and the sandbox could not be put back as it was (it could not be reached). The Vault gives it everything it holds again, and takes out what was left, the next time it is reached.");
      throw error;
    } finally {
      inflight.delete(about);
    }
  };

  /** `entries` with the secret field `name` of entry `entryId` recorded as used. */
  const used = (all: Kept[], entryId: string, name: string, last: LastUsed): Kept[] =>
    all.map((e) => (e.id === entryId ? { ...e, secret: e.secret.map((f) => (f.name === name ? { ...f, last } : f)) } : e));
  /** Record a use, not more than once a minute for the same. */
  const recordUse = (entryId: string, name: string, last: Omit<LastUsed, "at">): void => {
    const before = entries.find((e) => e.id === entryId)?.secret.find((f) => f.name === name);
    if (!before) return;
    if (before.last && before.last.what === last.what && Date.parse(now()) - Date.parse(before.last.at) < RECORD_EVERY_MS) return;
    void serial(async () => {
      if (entries.some((e) => e.id === entryId)) commit(used(entries, entryId, name, { ...last, at: now() }));
    }).catch(() => {});
  };

  const sealField = (entryId: string, input: SecretInput): Sealed => {
    const body = bytesOf(input.value);
    return {
      name: input.name,
      role: input.role,
      kind: input.value.kind,
      filename: input.value.kind === "file" ? input.value.filename : null,
      size: body.length,
      hint: input.value.kind === "text" ? hintOf(input.value.text) : null,
      sealed: seal.seal(body, entryId, input.name),
      last: null,
    };
  };

  const uniqueNames = (what: string, plain: readonly { name: string }[], secret: readonly { name: string }[]) => {
    const seen = new Set<string>();
    for (const { name } of [...plain, ...secret]) {
      const key = name.trim().toLowerCase();
      if (seen.has(key)) throw unsound(`${what} has two fields called ${name}.`);
      seen.add(key);
    }
  };
  /** `name`, or with a number after it when an entry has it already. */
  const uniqueName = (name: string): string => {
    let free = name.trim();
    for (let n = 2; entries.some((e) => e.name.toLowerCase() === free.toLowerCase()); n++) free = `${name.trim()} (${n})`;
    return free;
  };
  const freeName = (name: string, besides?: string) => {
    if (entries.some((e) => e.id !== besides && e.name.trim().toLowerCase() === name.trim().toLowerCase())) throw unsound(`There is already an entry called ${name.trim()}.`);
  };
  /** The plain fields as they are kept. */
  const plainOf = (inputs: readonly PlainInput[]): PlainField[] => inputs.map(({ name, role, value }) => ({ name, role, value }));

  /** An entry's uses, added one by one against everything there is. Returns the entries with them in. */
  const withUses = (all: Kept[], entryId: string, inputs: readonly UseInput[]): { all: Kept[]; added: Use[] } => {
    let current = all;
    const added: Use[] = [];
    for (const input of inputs) {
      const checked = checkUse(views(current), entryId, input, SANDBOX_HOME);
      if (!checked.ok) throw unsound(checked.reason);
      const use: Use = { ...checked.use, id: id("u") };
      current = replace(current, { ...find(current, entryId), uses: [...find(current, entryId).uses, use] });
      added.push(use);
    }
    return { all: current, added };
  };

  /** A new entry; `deliver`: whether its sandbox uses are given to the sandbox now. */
  const create = (p: Params, deliver: boolean): Promise<string> =>
    serial(async () => {
      const name = p.name.trim();
      freeName(name);
      if (entries.length >= MOST_ENTRIES) throw unsound(`There are ${MOST_ENTRIES} entries already.`);
      if (p.plain.length > MOST_FIELDS || p.secret.length > MOST_FIELDS) throw unsound(`An entry holds ${MOST_FIELDS} fields on each side at most.`);
      uniqueNames(name, p.plain, p.secret);
      const entryId = id("e");
      const entry: Kept = { id: entryId, name, managed: false, note: p.note.trim(), created: now(), plain: plainOf(p.plain), secret: p.secret.map((f) => sealField(entryId, f)), uses: [] };
      const { all, added } = withUses([...entries, entry], entryId, p.uses);
      const made = find(all, entryId);
      const going = deliver ? added.filter(inSandbox) : [];
      await delivering(maskFor(made, going), async (step) => {
        let next = all;
        for (const use of going) {
          await step(() => take(use), () => put(made, use));
          next = used(next, entryId, use.field, { at: now(), how: "sandbox", what: describeUse(use) });
        }
        commit(next);
      });
      return entryId;
    });

  /** What the sandbox says of a secret that cannot be opened is not told: it could not be masked. */
  const withheld = (e: Kept, field: string) =>
    new SandboxError(`What the sandbox printed is withheld: ${e.name} ${field} is in it, and could not be opened to be masked. Check the Vault's key.`);

  /** `e`'s secrets that had one of `uses` in the sandbox, kept masked after they are replaced or taken away (what cannot be opened cannot be masked, and is said). */
  const retiring = (e: Kept, uses: readonly Use[]) => {
    try {
      retire(maskFor(e, uses));
    } catch {
      warn(`${e.name} was replaced or removed, but its old value could not be opened to keep masking it.`);
    }
  };

  /** The values to mask for the secret fields of `e` that have one of `uses` in the sandbox. */
  const maskFor = (e: Kept, uses: readonly Use[] = e.uses): Masking[] =>
    e.secret
      .filter((f) => uses.some((u) => u.field === f.name && inSandbox(u)))
      .flatMap((f) => {
        try {
          return maskings(labelOf(view(e), f.name), f.kind === "text" ? textOf(e, f.name) : bytes(e, f.name));
        } catch {
          throw withheld(e, f.name);
        }
      });

  const store: SecretStore = {
    list: async () => views(),
    add: async (p) => ({ id: await create(p, true) }),

    edit: ({ id: entryId, name, note, plain }) =>
      serial(async () => {
        const before = yours(entries, entryId);
        const trimmed = name.trim();
        freeName(trimmed, entryId);
        if (plain.length > MOST_FIELDS) throw unsound(`An entry holds ${MOST_FIELDS} fields on each side at most.`);
        uniqueNames(trimmed, plain, before.secret);
        for (const old of before.plain) {
          const user = before.uses.find((u) => u.field === old.name);
          if (user && !plain.some((f) => f.name === old.name)) throw unsound(`${old.name} is used as ${describeUse(user)}: take that use away first.`);
        }
        const after: Kept = { ...before, name: trimmed, note: note.trim(), plain: plainOf(plain) };
        // a plain field's new value goes to the sandbox where it is used
        await delivering([], async (step) => {
          for (const field of after.plain) {
            const was = before.plain.find((f) => f.name === field.name);
            if (was && JSON.stringify(was.value) === JSON.stringify(field.value)) continue;
            for (const use of after.uses.filter((u) => u.field === field.name)) await step(() => put(before, use), () => put(after, use));
          }
          commit(replace(entries, after));
        });
      }),

    setSecret: ({ id: entryId, field }) =>
      serial(async () => {
        const before = yours(entries, entryId);
        const existing = before.secret.find((f) => f.name === field.name);
        if (!existing && before.secret.length >= MOST_FIELDS) throw unsound(`An entry holds ${MOST_FIELDS} fields on each side at most.`);
        if (!existing) uniqueNames(before.name, before.plain, [...before.secret, field]);
        if (existing && existing.kind !== field.value.kind && before.uses.some((u) => u.field === field.name))
          throw unsound(`${field.name} is used: take its uses away before it changes between a line and a file.`);
        const sealed = sealField(entryId, field);
        // the new value keeps the old one's last use
        const next: Sealed = existing ? { ...sealed, last: existing.last } : sealed;
        const after: Kept = { ...before, secret: existing ? before.secret.map((f) => (f.name === field.name ? next : f)) : [...before.secret, next] };
        const going = after.uses.filter((u) => u.field === field.name);
        await delivering(maskFor(after, going), async (step) => {
          for (const use of going) await step(() => put(before, use), () => put(after, use));
          commit(replace(entries, after));
          // the old value is not the field's any more, but a program may have kept it: it stays masked
          if (existing && going.length > 0) retiring(before, going);
        });
      }),

    reveal: async ({ id: entryId, field }) => {
      const entry = yours(entries, entryId);
      if (!entry.secret.some((f) => f.name === field)) throw unsound(`${entry.name} has no secret called ${field}.`);
      return textOf(entry, field);
    },

    removeSecret: ({ id: entryId, name }) =>
      serial(async () => {
        const before = yours(entries, entryId);
        if (!before.secret.some((f) => f.name === name)) throw unsound(`${before.name} has no secret field called ${name}.`);
        if (before.secret.length === 1) throw unsound(`${before.name} needs a secret: remove the entry instead.`);
        await delivering([], async (step) => {
          for (const use of before.uses.filter((u) => u.field === name)) await step(() => put(before, use), () => take(use));
          commit(replace(entries, { ...before, secret: before.secret.filter((f) => f.name !== name), uses: before.uses.filter((u) => u.field !== name) }));
          retiring(before, before.uses.filter((u) => u.field === name));
        });
      }),

    use: ({ id: entryId, use: input }) => addUse(entryId, input, true, false),
    useByAgent: ({ id: entryId, use: input }, approved) => addUse(entryId, input, approved, true),

    unuse: ({ id: entryId, use: useId }) =>
      serial(async () => {
        const before = yours(entries, entryId);
        const use = before.uses.find((u) => u.id === useId);
        if (!use) throw unsound("That use is not there any more.");
        await delivering([], async (step) => {
          await step(() => put(before, use), () => take(use));
          commit(replace(entries, { ...before, uses: before.uses.filter((u) => u.id !== useId) }));
          retiring(before, [use]);
        });
      }),

    remove: (entryId) =>
      serial(async () => {
        const before = find(entries, entryId);
        await delivering([], async (step) => {
          for (const use of before.uses) await step(() => put(before, use), () => take(use));
          commit(entries.filter((e) => e.id !== entryId));
          retiring(before, before.uses);
        });
      }),

    async answer(request: SecretRequest, answer: SecretAnswer) {
      const ask = request.deliver;
      if (ask.kind === "temporary" && answer.kind === "temporary") {
        try {
          await sandboxOf().typeSecret({ pane: ask.pane, value: answer.value });
        } catch (error) {
          // the likely why, in words: what waited for it has ended, or the terminal is gone
          throw error instanceof SandboxError
            ? unsound(`Nothing in terminal ${ask.pane} is waiting for it now (what asked may have ended, or the terminal is closed). Ask Amuse to start it again.`)
            : error;
        }
        // in memory alone, only to mask what the terminal shows of it; it is not listed, tracked or written down
        codes.set(answer.value, Date.now() + CODE_MS);
        return;
      }
      if (ask.kind === "stored" && answer.kind === "stored") {
        // a card an agent wrote puts things in the sandbox; a service of Amuse's own is the user's to set up
        if (ask.uses.some((u) => u.kind === "server")) throw unsound("A card can set up variables and files only.");
        const given = (side: readonly { name: string; value: FieldValue }[], name: string): FieldValue => {
          const found = side.find((g) => g.name === name)?.value;
          if (!found) throw unsound(`${name} is missing.`);
          return found;
        };
        // filling the card in is the user's word for the uses written on it
        await create(
          {
            name: request.name,
            note: ask.note,
            // the plain fields are the ones Amuse filled in on the card; the user typed secrets only
            plain: ask.plain.map(({ name, role, value }) => ({ name, role, value })),
            secret: ask.secret.map(({ name, role }) => ({ name, role, value: given(answer.secret, name) })),
            uses: ask.uses,
          },
          true,
        );
        return;
      }
      throw unsound("That does not fit what the card asked.");
    },

    masked() {
      masks ??= entries.flatMap((e) => maskFor(e));
      const later = Date.now();
      for (const [code, until] of codes) if (until <= later) codes.delete(code);
      return [...masks, ...retired, ...[...inflight].flat(), ...[...codes.keys()].flatMap((value) => maskings("temporary code", value))];
    },

    relabel: (names) =>
      serial(async () => {
        let next = entries;
        for (const e of entries) {
          const served = e.uses.find((u) => u.kind === "server" && (u.service === "model" || u.service === "apps") && u.target === e.name);
          if (!served || served.kind !== "server") continue;
          const name = names(served.target);
          if (name !== e.name && !next.some((o) => o.id !== e.id && o.name.toLowerCase() === name.toLowerCase())) next = replace(next, { ...e, name });
        }
        if (next !== entries) commit(next);
      }),

    again: () =>
      serial(async () => {
        // inside the line of changes, so that one made meanwhile (a removal) is not undone by this; the home was emptied, so what was
        // waiting to be taken out is gone, and what was kept masked has nothing left to mask
        retired.length = 0;
        db.exec("delete from sandbox_cleanup");
        stale = false;
        await redeliver();
      }),

    sweep: () =>
      serial(async () => {
        if (!sandbox) return;
        const waiting = query(db, z.object({ kind: z.enum(["env", "file"]), target: z.string() }), "select kind, target from sandbox_cleanup order by kind, target");
        for (const { kind, target } of waiting) {
          try {
            await sandbox.forget(kind === "env" ? { env: target } : { file: target });
            db.prepare("delete from sandbox_cleanup where kind = ? and target = ?").run(kind, target);
          } catch (error) {
            if (!(error instanceof SandboxError)) throw error;
            warn(`The sandbox cannot be reached just now, so ${waiting.length} thing${waiting.length === 1 ? "" : "s"} to take out of it wait${waiting.length === 1 ? "s" : ""}.`);
            return;
          }
        }
        if (await redeliver()) stale = false;
      }),

    serviceKey(service, target, record = true) {
      const found = views().flatMap((entry) => entry.uses.flatMap((use) => (use.kind === "server" && use.service === service && use.target === target ? [{ entry, use }] : [])))[0];
      if (!found) return undefined;
      const kept = find(entries, found.entry.id);
      const values: Record<string, string> = {};
      for (const field of [...kept.plain.map((f) => f.name), ...kept.secret.filter((f) => f.kind === "text").map((f) => f.name)]) {
        try {
          values[field] = textOf(kept, field);
        } catch {
          // not text, or not openable: left out
        }
      }
      // a key that cannot be read is no key: the service is told there is none, not handed the rest of it
      if (values[found.use.field] === undefined) {
        warn(`The key for ${describeUse(found.use)} (${kept.name} ${found.use.field}) could not be read from the Vault, so it is treated as missing.`);
        return undefined;
      }
      if (record) recordUse(kept.id, found.use.field, { how: "server", what: describeUse(found.use) });
      return { entry: found.entry, field: found.use.field, values };
    },

    serviceTargets: () => entries.flatMap((e) => e.uses.flatMap((u) => (u.kind === "server" ? [{ service: u.service, target: u.target }] : []))),

    putService: (write) =>
      serial(async () => {
        const first = write.targets[0];
        if (!first) throw unsound("A service key serves something.");
        for (const { text } of [...write.plain, ...write.secret]) if (/[\r\n]/.test(text) || text.length > MAX_LINE) throw unsound("A service's setting is a line of text.");
        if (write.secret.length === 0 || !write.secret.some((f) => f.name === write.bound)) throw unsound("A service key has a secret to keep.");
        const serving = (t: { service: string; target: string }) => entries.find((e) => e.uses.some((u) => u.kind === "server" && u.service === t.service && u.target === t.target));
        const before = serving(first);
        // a service has one key: another entry's is not given a second
        for (const t of write.targets) {
          const other = serving(t);
          if (other && other.id !== before?.id) throw unsound(`${describeUse({ kind: "server", field: write.bound, service: t.service, target: t.target })} is served by ${other.name} already.`);
        }
        const entryId = before?.id ?? id("e");
        const plain: PlainField[] = write.plain.map(({ name, text }) => ({ name, role: null, value: { kind: "text", text } }));
        const secret: Sealed[] = write.secret.map(({ name, text }) => {
          const sealed = sealField(entryId, { name, role: null, value: { kind: "text", text } });
          return { ...sealed, last: before?.secret.find((f) => f.name === name)?.last ?? null };
        });
        const names = new Set([...plain, ...secret].map((f) => f.name));
        const kept = (before?.uses ?? []).filter((u) => names.has(u.field));
        const dropped = (before?.uses ?? []).filter((u) => !names.has(u.field));
        const served = write.targets
          .filter((t) => !kept.some((u) => u.kind === "server" && u.service === t.service && u.target === t.target))
          .map((t): Use => ({ id: id("u"), kind: "server", field: write.bound, service: t.service, target: t.target }));
        const after: Kept = {
          id: entryId,
          name: before?.name ?? uniqueName(write.name),
          managed: write.managed,
          note: before?.note ?? "",
          created: before?.created ?? now(),
          plain,
          secret,
          uses: [...kept, ...served],
        };
        // a key the user also gave to the sandbox goes there anew
        await delivering(maskFor(after, after.uses), async (step) => {
          for (const use of dropped) if (before) await step(() => put(before, use), () => take(use));
          for (const use of after.uses.filter(inSandbox)) {
            const was = before?.uses.find((u) => u.id === use.id);
            await step(() => (before && was ? put(before, was) : take(use)), () => put(after, use));
          }
          commit(before ? replace(entries, after) : [...entries, after]);
          // a rotated key, or fields that are gone: the old values stay masked
          if (before) retiring(before, before.uses);
        });
      }),

    dropService: (service, target) =>
      serial(async () => {
        const before = entries.find((e) => e.uses.some((u) => u.kind === "server" && u.service === service && u.target === target));
        if (!before) return;
        await delivering([], async (step) => {
          for (const use of before.uses) await step(() => put(before, use), () => take(use));
          commit(entries.filter((e) => e.id !== before.id));
          retiring(before, before.uses);
        });
      }),

    serviceSecrets() {
      return entries
        .filter((e) => e.uses.some((u) => u.kind === "server"))
        .flatMap((e) =>
          e.secret.flatMap((f) => {
            try {
              return f.kind === "text" ? [textOf(e, f.name)] : [];
            } catch {
              return [];
            }
          }),
        );
    },

    async adopt(list) {
      const made: string[] = [];
      const taken: { name: string; by: string; same: boolean }[] = [];
      for (const p of list) {
        const owners = new Map(entries.flatMap((e) => e.uses.map((u): [string, Kept] => [claim(u), e])));
        const clash = p.uses.map((u) => owners.get(claim(u))).find((owner) => owner !== undefined);
        if (clash) {
          // a use that is taken already: this was adopted before (the same name), or something else has it
          taken.push({ name: p.name.trim(), by: clash.name, same: clash.name === p.name.trim() || clash.name.startsWith(`${p.name.trim()} (`) });
          continue;
        }
        made.push(await create({ ...p, name: uniqueName(p.name) }, false));
      }
      return { made, taken };
    },
  };

  /** Add a use; a secret field's first use in the sandbox only when `approved`. */
  function addUse(entryId: string, input: UseInput, approved: boolean, byAgent: boolean): Promise<Use> {
    return serial(async () => {
      yours(entries, entryId);
      if (byAgent && input.kind === "server") throw unsound("An agent adds variables and files only: a service of Amuse's own is set up by the user.");
      const checked = checkUse(views(), entryId, input, SANDBOX_HOME);
      if (!checked.ok) throw unsound(checked.reason);
      if (checked.needsCard && !approved) throw unsound(`${input.field} has not been in the sandbox before: the user has to allow that first.`);
      const { all, added } = withUses(entries, entryId, [input]);
      const use = added[0];
      if (!use) throw unsound("That use could not be added.");
      const made = find(all, entryId);
      await delivering(maskFor(made, [use]), async (step) => {
        await step(() => take(use), () => put(made, use));
        commit(inSandbox(use) ? used(all, entryId, use.field, { at: now(), how: "sandbox", what: describeUse(use) }) : all);
      });
      return use;
    });
  }

  return store;
}
