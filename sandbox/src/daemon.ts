/**
 * The sandbox's control daemon: Amuse's way to work inside its own machine.
 * It listens on the sandbox network only, which it shares with the Amuse server
 * and Amuse's browsers (so they can open what runs here). Whatever runs here can
 * already do all it can ask (the user has sudo), so it asks for no token; but
 * nothing a browser sends is taken, so a page open in one of those browsers
 * cannot drive it (a browser always says where a POST or a websocket comes
 * from, in `Origin`; the server's own requests never do). It runs as root, so that it
 * can always stop what it started and clean up after it, but every command it
 * starts runs as the normal user (`user`), never as root unless it says sudo.
 *
 * A command runs to completion in a process group of its own (output kept
 * within bounds, a timeout, stopped if the asker goes away). It is over when
 * its own process is; whatever it left running in its group is stopped with
 * it, and a process that got away (setsid, a daemon) no longer holds the
 * answer back. What should go on running, or be typed into, goes in one of
 * the terminals Amuse and the user share, which are herdr's: the daemon keeps
 * `herdr server` running as the user, and a websocket at /terminal shows
 * herdr's own interface in a pseudo-terminal (terminal.ts). Reset stops
 * everything and empties the home folder back to its skeleton, never touching
 * the workspace; herdr's server is started again on it. What a reset would
 * delete, outside the workspace, is listed first (/at-risk), so the user can
 * have anything they want to keep moved out before it goes.
 *
 * Credentials the user gave for the sandbox (through the Amuse server, never
 * the agent) are kept here: as environment variables every command gets (a
 * file of them, the user's only), or as files of the user's in the home
 * folder; or typed once into a terminal (a CLI waiting for a code).
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, readFileSync, statSync } from "node:fs";
import { chmod, lchown, lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { HerdrError, herdrCall } from "./herdr.ts";
import { Clip } from "./output.ts";
import {
  AtRiskFolder,
  Cols,
  DEFAULT_TIMEOUT,
  Forget,
  HANDOFF_SECONDS,
  JOB_LIFETIME,
  type JobEnd,
  JobRef,
  type JobState,
  MAX_JOBS,
  Rows,
  Run,
  SecretEnv,
  SecretFile,
  SecretTyped,
  Start,
  StopJobs,
  TERMINAL_PATH,
} from "./protocol.ts";
import { relayTerminal } from "./terminal.ts";

export interface Options {
  /** the user's home: emptied by a reset */
  home: string;
  /** the folder shared with Amuse (inside home): where commands start, and never emptied */
  workspace: string;
  /** what a fresh home holds (/etc/skel) */
  skeleton: string;
  port: number;
  host: string;
  /** who commands run as (the daemon itself runs as root, and cannot be asked to run one as root); without one, as the daemon */
  user?: { uid: number; gid: number; name: string };
  /** whether this is the sandbox's own container, where a reset may end every process there is (never on a machine that is not) */
  isolated?: boolean;
  /** herdr's binary: kept running as its server, and what a terminal shows; without it, no terminals */
  herdr?: string;
  /** how long a job is waited for before it is handed off, and how long it may live (ms; the protocol's, unless a test shortens them) */
  handoffMs?: number;
  lifetimeMs?: number;
}

/** A running daemon: where it listens, and how to stop it (what it runs too). */
export interface Listening {
  port: number;
  close(): Promise<void>;
}

/** Output of a command that runs to completion: how much is kept at each end. */
const FIRST = 6_000;
const LAST = 24_000;
/** Largest request taken. */
const MAX_BODY = 1024 ** 2;
/** A long command is kept from looking idle to whoever waits for it. */
const BEAT_MS = 20_000;
/** After a command's process ends, how long its output is still waited for, from pipes something else may hold open. */
const GRACE_MS = 300;
/** Terminals open at once; how long one waits for herdr's server to be there (ms); and how soon a server that ended is started again. */
const TERMINALS = 8;
const SERVER_WAIT_MS = 10_000;
const RESTART_MS = 2_000;
/** Of the jobs that ended, how many of a chat are kept readable, and for how long (ms). */
const KEPT_JOBS = 20;
const KEPT_MS = 3_600_000;
/** A server that keeps ending is started again less and less often, up to this (ms); one that ran this long starts the count over. */
const LONGEST_RESTART_MS = 60_000;
/** How deep a scan of the home folder looks for what a reset would delete, and how many folders it names at most. */
const AT_RISK_DEPTH = 3;
const AT_RISK_MOST = 20;

/** A request that cannot be done, with why in words. */
class Refused extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

interface End {
  exitCode: number | null;
  signal: string | null;
}

/** A command started in a process group of its own. */
interface Job {
  /** how it ended, once it has and its output is all in */
  ended: Promise<End>;
  /** a signal to the whole group */
  signal(name: NodeJS.Signals): void;
  /** ask the group to end, then force it after `grace` ms */
  stop(grace: number): void;
}

/** A job of a chat, from its start until it is forgotten. */
interface Tracked {
  id: string;
  chat: string;
  job: Job;
  clip: Clip;
  startedAt: number;
  endedAt: number;
  /** how it ended, once it has and its output is all in */
  end: JobEnd | null;
  /** why it is being ended, once something has asked */
  why: JobEnd["reason"] | null;
  /** settles when `end` is there */
  over: Promise<void>;
}

/** What herdr says its workspaces are (only how many matters here). */
const Listed = z.object({ workspaces: z.array(z.unknown()) });
/** What runs in a pane, as herdr says: whether the shell itself is in the foreground (at its prompt). */
const Running = z.object({
  process_info: z.object({ shell_pid: z.int().nullable().default(null), foreground_process_group_id: z.int().nullable().default(null) }),
});

/** A request a browser made (a page's form, script or websocket): it says where it comes from; the server's never do. */
const fromBrowser = (req: IncomingMessage) => req.headers.origin !== undefined || req.headers["sec-fetch-site"] !== undefined;

/** `text` as one word for bash. */
const quoted = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

const said = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What was wrong with a request, as a sentence. */
const wrong = (error: z.ZodError) => error.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ");

export function serve({ home, workspace, skeleton, port, host, user, isolated = false, herdr, handoffMs = HANDOFF_SECONDS * 1000, lifetimeMs = JOB_LIFETIME * 1000 }: Options): Promise<Listening> {
  /** Everything started and not yet ended, so a reset or a shutdown can stop it. */
  const jobs = new Set<Job>();
  // the user's own groups only, not root's, for what it starts
  if (user) process.setgroups?.([user.gid]);
  /** What a command sees, as a login of the user would set it. */
  const environment = { ...process.env, HOME: home, ...(user ? { USER: user.name, LOGNAME: user.name, SHELL: "/bin/bash" } : {}) };
  /** The credentials given as environment variables, kept for the user alone (and gone with a reset of home). */
  const secretsFile = join(home, ".config", "amuse", "secrets.json");
  const secrets = (): Record<string, string> => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(secretsFile, "utf8"));
      return typeof parsed === "object" && parsed !== null
        ? Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
        : {};
    } catch {
      return {};
    }
  };

  /**
   * `command` in a bash of its own, in `cwd`, its output going to `clip`. It gets the credentials as they are now,
   * unless it is `lasting` (herdr's server: its shells read them as they start).
   */
  const launch = (command: string, cwd: string, clip: Clip, { lasting = false } = {}): Job => {
    const child = spawn("bash", ["-c", command], {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: lasting ? environment : { ...environment, ...secrets() },
      ...(user ? { uid: user.uid, gid: user.gid } : {}),
    });
    const group = child.pid;
    const signal = (name: NodeJS.Signals) => {
      if (group === undefined) return;
      try {
        process.kill(-group, name);
      } catch {
        // the group is gone already
      }
    };
    // both are pipes (the stdio above)
    const outputs = [child.stdout, child.stderr].filter((stream) => stream !== null);
    for (const stream of outputs) {
      stream.setEncoding("utf8");
      stream.on("data", (text: string) => clip.append(text));
    }
    const ended = new Promise<End>((done, failed) => {
      child.once("error", failed);
      child.once("exit", (exitCode, by) => {
        // what the command leaves running in its group goes with it
        signal("SIGKILL");
        // its output is all in once the pipes close; one something else holds open (a process that got away) is not waited for
        const finish = () => {
          clearTimeout(grace);
          for (const stream of outputs) stream.destroy();
          done({ exitCode, signal: by });
        };
        const grace = setTimeout(finish, GRACE_MS);
        child.once("close", finish);
      });
    });
    const job: Job = {
      ended,
      signal,
      stop(grace) {
        signal("SIGTERM");
        const force = setTimeout(() => signal("SIGKILL"), grace);
        const clear = () => clearTimeout(force);
        ended.then(clear, clear);
      },
    };
    jobs.add(job);
    const forget = () => void jobs.delete(job);
    ended.then(forget, forget);
    return job;
  };

  /** A folder to work in: relative to the workspace, or absolute. */
  const folder = (cwd: string | undefined): string => {
    const path = resolve(workspace, cwd ?? "");
    try {
      if (statSync(path).isDirectory()) return path;
    } catch {
      // not there
    }
    throw new Refused(`There is no folder ${cwd ?? path}.`);
  };

  /* ---------- running to completion ---------- */

  const run = async (request: Run, res: ServerResponse) => {
    const cwd = folder(request.cwd);
    // the answer comes when the command is done; its head goes out now, with a blank now and then, so a long wait is not taken for a dead line
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.flushHeaders();
    const clip = new Clip(FIRST, LAST);
    const job = launch(request.command, cwd, clip);
    let timedOut = false;
    let over = false;
    const timer = setTimeout(
      () => {
        timedOut = true;
        job.stop(3_000);
      },
      (request.timeout ?? DEFAULT_TIMEOUT) * 1000,
    );
    const beat = setInterval(() => res.write(" "), BEAT_MS);
    // whoever asked went away (the user stopped Amuse): the command stops
    res.once("close", () => {
      if (!over) job.signal("SIGKILL");
    });
    let end: End = { exitCode: null, signal: null };
    try {
      end = await job.ended;
    } catch (error) {
      clip.append(`Could not start the command: ${said(error)}`);
    } finally {
      over = true;
      clearTimeout(timer);
      clearInterval(beat);
    }
    res.end(JSON.stringify({ ...clip.result(), ...end, timedOut }));
  };

  /* ---------- jobs ---------- */

  const tracked = new Map<string, Tracked>();
  let counted = 0;

  const stateOf = (t: Tracked): JobState => ({
    id: t.id,
    running: t.end === null,
    seconds: Math.round(((t.end ? t.endedAt : Date.now()) - t.startedAt) / 1000),
    ...t.clip.result(),
    end: t.end,
  });

  /** Forget the jobs that ended long ago, and all but the newest of a chat's. */
  const tidy = () => {
    const seen = new Map<string, number>();
    for (const t of [...tracked.values()].filter((j) => j.end).sort((a, b) => b.endedAt - a.endedAt)) {
      const count = (seen.get(t.chat) ?? 0) + 1;
      seen.set(t.chat, count);
      if (count > KEPT_JOBS || Date.now() - t.endedAt > KEPT_MS) tracked.delete(t.id);
    }
  };

  /** Ask a running job to end, for `reason`, and force it after `grace` ms. */
  const end = (t: Tracked, reason: JobEnd["reason"], grace: number) => {
    if (t.end) return;
    t.why ??= reason;
    t.job.stop(grace);
  };

  /** A job of `chat` by its id; another chat's is not seen. */
  const owned = ({ chat, id }: JobRef): Tracked => {
    const t = tracked.get(id);
    if (!t || t.chat !== chat) throw new Refused(`There is no job ${id} in this chat: it may be too old to be kept, or lost when the sandbox restarted.`, 404);
    return t;
  };

  const startJob = async (request: Start, res: ServerResponse) => {
    tidy();
    const running = [...tracked.values()].filter((t) => t.chat === request.chat && !t.end);
    if (running.length >= MAX_JOBS) throw new Refused(`${MAX_JOBS} jobs are running in this chat already (${running.map((t) => t.id).join(", ")}).`, 429);
    const cwd = folder(request.cwd);
    const clip = new Clip(FIRST, LAST);
    const job = launch(request.command, cwd, clip);
    const t: Tracked = { id: `j${++counted}`, chat: request.chat, job, clip, startedAt: Date.now(), endedAt: 0, end: null, why: null, over: Promise.resolve() };
    tracked.set(t.id, t);
    const limit = setTimeout(() => end(t, "timedOut", 3_000), lifetimeMs);
    t.over = job.ended
      .catch((error: unknown) => {
        clip.append(`Could not start the command: ${said(error)}`);
        return { exitCode: null, signal: null };
      })
      .then((how) => {
        clearTimeout(limit);
        t.endedAt = Date.now();
        t.end = { ...how, reason: t.why ?? "finished" };
      });
    // whoever asked went away before it was handed off (the user stopped Amuse): it stops, as a command does
    let answered = false;
    res.once("close", () => {
      if (answered) return;
      t.why ??= "stopped";
      job.signal("SIGKILL");
    });
    let handoff: NodeJS.Timeout | undefined;
    await Promise.race([t.over, new Promise<void>((done) => (handoff = setTimeout(done, request.background ? 0 : handoffMs)))]);
    clearTimeout(handoff);
    answered = true;
    return stateOf(t);
  };

  const stopJobs = async ({ chat, id }: StopJobs) => {
    const those = id === undefined ? [...tracked.values()].filter((t) => t.chat === chat && !t.end) : [owned({ chat, id })];
    for (const t of those) end(t, "stopped", 3_000);
    await Promise.all(those.map((t) => t.over));
    return { jobs: those.map(stateOf) };
  };

  const waitJob = async (ref: JobRef) => {
    const t = owned(ref);
    await t.over;
    return stateOf(t);
  };

  /* ---------- terminals ---------- */

  /** herdr's server, while it runs; kept running while `tending` (not during a reset, nor once closed). */
  let keeper: Job | null = null;
  let tending = herdr !== undefined;
  const herdrSocket = join(home, ".config", "herdr", "herdr.sock");
  // doubled before each quick restart, so the first comes after RESTART_MS
  let restartIn = RESTART_MS / 2;
  const tend = () => {
    if (!herdr || !tending || keeper) return;
    const job = launch(`exec ${quoted(herdr)} server`, workspace, new Clip(0, 20_000), { lasting: true });
    keeper = job;
    const started = Date.now();
    const again = () => {
      keeper = null;
      restartIn = Date.now() - started >= LONGEST_RESTART_MS ? RESTART_MS : Math.min(restartIn * 2, LONGEST_RESTART_MS);
      if (tending) setTimeout(tend, restartIn).unref();
    };
    job.ended.then(again, again);
  };

  let terminals = 0;
  /** Show herdr's interface on `ws`, once its server is there. */
  const openTerminal = async (ws: WebSocket, url: URL) => {
    if (!herdr) return ws.close(4404, "There are no terminals here.");
    if (terminals >= TERMINALS) return ws.close(4429, `${TERMINALS} terminals are open; close one first.`);
    // the slot is taken now, before any wait, and given back if the terminal never opens
    terminals++;
    // what the viewer sends meanwhile (its size, the first keys) is kept for the terminal
    const early: { data: RawData; binary: boolean }[] = [];
    const keep = (data: RawData, binary: boolean) => void early.push({ data, binary });
    ws.on("message", keep);
    const give = (code: number, reason: string) => {
      terminals--;
      ws.off("message", keep);
      ws.close(code, reason);
    };
    if (resetting) await resetting.catch(() => {});
    for (const start = Date.now(); !existsSync(herdrSocket); ) {
      if (Date.now() - start > SERVER_WAIT_MS || ws.readyState !== ws.OPEN) return give(4503, "The terminals are not running just now.");
      await new Promise((done) => setTimeout(done, 100));
    }
    // the user sees something to work in: with no workspace there (a fresh home, or every one closed), one in the workspace folder
    await herdrCall(herdrSocket, "workspace.list", {})
      .then((listed) =>
        Listed.safeParse(listed).data?.workspaces.length === 0
          ? herdrCall(herdrSocket, "workspace.create", { cwd: workspace, label: "workspace", focus: true })
          : undefined,
      )
      .catch(() => {});
    // the viewer may have gone while this waited
    if (ws.readyState !== ws.OPEN) return give(1000, "The viewer left.");
    ws.off("message", keep);
    const cols = Cols.safeParse(Number(url.searchParams.get("cols")));
    const rows = Rows.safeParse(Number(url.searchParams.get("rows")));
    const terminal = relayTerminal(ws, {
      early,
      command: [herdr],
      cols: cols.success ? cols.data : 80,
      rows: rows.success ? rows.data : 24,
      cwd: workspace,
      env: environment,
      ...(user ? { user } : {}),
    });
    const job: Job = {
      ended: terminal.ended.then(() => ({ exitCode: null, signal: null })),
      signal: terminal.signal,
      stop: () => terminal.signal("SIGKILL"),
    };
    jobs.add(job);
    void job.ended.then(() => {
      terminals--;
      jobs.delete(job);
    });
  };

  /* ---------- credentials ---------- */

  /** `path` (relative to home, or absolute) as a place in home, outside the workspace. */
  const homePath = (path: string): string => {
    const full = resolve(home, path);
    const within = relative(home, full);
    if (within === "" || within.startsWith("..") || resolve(home, within) !== full) throw new Refused("A credential file goes in the home folder.");
    const inWorkspace = relative(workspace, full);
    if (!inWorkspace.startsWith("..")) throw new Refused("A credential file does not go in the workspace: the user and Amuse's own tools read that.");
    return full;
  };

  /** Write `text` to `path` as the user's own, readable by them alone, with its folders. */
  const keep = async (path: string, text: string | Buffer) => {
    const folder = dirname(path);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    for (let at = folder; at !== home && at.startsWith(`${home}/`); at = dirname(at)) if (user) await lchown(at, user.uid, user.gid);
    // not following a link the user's programs may have left in its place
    await rm(path, { force: true });
    await writeFile(path, text, { mode: 0o600, flag: "wx" });
    await chmod(path, 0o600);
    if (user) await lchown(path, user.uid, user.gid);
  };

  const setEnv = async ({ name, value }: SecretEnv) => {
    await keep(secretsFile, JSON.stringify({ ...secrets(), [name]: value }));
    return {};
  };

  const setFile = async ({ path, value, encoding }: SecretFile) => {
    await keep(homePath(path), encoding === "base64" ? Buffer.from(value, "base64") : value);
    return {};
  };

  /**
   * A credential typed into a terminal (a CLI waiting for a code) and Enter after it: typed once, never kept here. Not
   * into a shell at its prompt: whatever asked for it is gone (a card can be answered long after), and the shell would
   * run it as a command, keep it in its history and show it.
   */
  const typeSecret = async ({ pane, value }: SecretTyped) => {
    if (!herdr) throw new Refused("There are no terminals here.", 404);
    try {
      const info = Running.safeParse(await herdrCall(herdrSocket, "pane.process_info", { pane_id: pane })).data?.process_info;
      // what cannot be told is not typed either
      if (!info || info.shell_pid === null || info.shell_pid === info.foreground_process_group_id)
        throw new Refused(`Nothing in ${pane} is waiting for it: the terminal is at its shell prompt.`, 409);
      await herdrCall(herdrSocket, "pane.send_input", { pane_id: pane, text: value, keys: ["enter"] });
    } catch (error) {
      if (error instanceof Refused) throw error;
      throw new Refused(error instanceof HerdrError ? `It could not be typed into ${pane}: ${error.message}` : `It could not be typed into ${pane}.`, 409);
    }
    return {};
  };

  const forget = async (what: Forget) => {
    if ("env" in what) {
      const rest = Object.fromEntries(Object.entries(secrets()).filter(([name]) => name !== what.env));
      await keep(secretsFile, JSON.stringify(rest));
    } else await rm(homePath(what.file), { force: true });
    return {};
  };

  /* ---------- reset ---------- */

  /**
   * Folders in the home folder, outside the workspace, that a reset would delete: the non-hidden ones, the ones
   * holding a `.git` marked (a repository of code is more likely to be the user's work than a tool's own folder).
   * A few levels deep and a handful of folders at most, so what the user is shown stays short. Hidden folders are
   * the tools' own (`.config`, `.cache`, `.agents`, `.npm` and the like) and are never listed; a folder that is a
   * link, or not a folder at all, is not work kept here either, and neither is anything mounted, which `empty`
   * leaves alone too.
   */
  const atRisk = async (): Promise<AtRiskFolder[]> => {
    const found: AtRiskFolder[] = [];
    const device = (await lstat(home)).dev;
    const look = async (dir: string, depth: number): Promise<void> => {
      for (const name of (await readdir(dir)).sort()) {
        if (found.length >= AT_RISK_MOST) return;
        if (name.startsWith(".")) continue;
        const path = join(dir, name);
        const info = await lstat(path).catch(() => null);
        if (!info?.isDirectory() || info.dev !== device || path === workspace) continue;
        const repository = existsSync(join(path, ".git"));
        found.push({ path: relative(home, path), repository });
        // a repository is one entry: what is inside it goes with it
        if (!repository && depth < AT_RISK_DEPTH) await look(path, depth + 1);
      }
    };
    await look(home, 1);
    return found;
  };

  const remove = async (path: string) => {
    try {
      await rm(path, { recursive: true, force: true });
    } catch {
      throw new Refused(`${path} could not be removed.`, 500);
    }
  };

  /** `path` and what is in it, given to the user (a copy made as root is root's). */
  const give = async (path: string): Promise<void> => {
    if (!user) return;
    await lchown(path, user.uid, user.gid);
    if ((await lstat(path)).isDirectory()) for (const name of await readdir(path)) await give(join(path, name));
  };

  /** Empty `dir`, leaving `keep` (the workspace) and anything mounted (a different device) alone. */
  const empty = async (dir: string, keep: string, device: number): Promise<void> => {
    for (const name of await readdir(dir)) {
      const path = join(dir, name);
      const info = await lstat(path);
      if (path === keep || info.dev !== device) continue;
      if (info.isDirectory() && keep.startsWith(`${path}/`)) await empty(path, keep, device);
      else await remove(path);
    }
  };

  /** Stop everything: in the sandbox's own container every process but the init and this daemon (a second round for what the first one's dying spawned), else what this daemon started. */
  const stopAll = async () => {
    const stopping = [...jobs];
    for (const t of tracked.values()) if (!t.end) t.why = "reset";
    for (let round = 0; round < 2; round++) {
      if (isolated) {
        try {
          process.kill(-1, "SIGKILL");
        } catch {
          // nothing left to signal
        }
      } else for (const job of stopping) job.signal("SIGKILL");
      await new Promise((done) => setTimeout(done, 200));
    }
    await Promise.allSettled(stopping.map((job) => job.ended));
  };

  const reset = async () => {
    // herdr's server goes with everything else, and is started again on the emptied home
    tending = false;
    try {
      await stopAll();
      await empty(home, workspace, (await lstat(home)).dev);
      if (existsSync(skeleton)) {
        cpSync(skeleton, home, { recursive: true, force: true });
        for (const name of await readdir(skeleton)) await give(join(home, name));
      }
    } finally {
      tending = herdr !== undefined;
      tend();
    }
  };
  /** The reset in progress: whatever is asked meanwhile waits for it. */
  let resetting: Promise<void> | null = null;

  /* ---------- http ---------- */

  const json = (res: ServerResponse, status: number, value: unknown) =>
    void res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(value));

  const body = async (req: IncomingMessage): Promise<unknown> => {
    let text = "";
    req.setEncoding("utf8");
    for await (const chunk of req) {
      text += chunk;
      if (text.length > MAX_BODY) throw new Refused("The request is too large.", 413);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Refused("The request is not JSON.");
    }
  };

  const asked = async <T>(req: IncomingMessage, shape: z.ZodType<T>): Promise<T> => {
    const parsed = shape.safeParse(await body(req));
    if (!parsed.success) throw new Refused(wrong(parsed.error));
    return parsed.data;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://local");
    const path = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const route = `${req.method} /${path.join("/")}`;
    if (resetting && route !== "POST /reset") await resetting.catch(() => {});
    switch (route) {
      case "GET /health":
        return json(res, 200, {});
      case "GET /at-risk":
        return json(res, 200, { folders: await atRisk() });
      case "POST /run":
        return await run(await asked(req, Run), res);
      case "POST /jobs":
        return json(res, 200, await startJob(await asked(req, Start), res));
      case "POST /jobs/output":
        return json(res, 200, stateOf(owned(await asked(req, JobRef))));
      case "POST /jobs/stop":
        return json(res, 200, await stopJobs(await asked(req, StopJobs)));
      case "POST /jobs/wait":
        return json(res, 200, await waitJob(await asked(req, JobRef)));
      case "POST /secrets/env":
        return json(res, 200, await setEnv(await asked(req, SecretEnv)));
      case "POST /secrets/file":
        return json(res, 200, await setFile(await asked(req, SecretFile)));
      case "POST /secrets/type":
        return json(res, 200, await typeSecret(await asked(req, SecretTyped)));
      case "POST /secrets/forget":
        return json(res, 200, await forget(await asked(req, Forget)));
      case "POST /reset":
        resetting ??= reset().finally(() => void (resetting = null));
        await resetting;
        return json(res, 200, {});
      default:
        return json(res, 404, { error: "There is no such request." });
    }
  };

  const http = createServer((req, res) => {
    if (fromBrowser(req)) return json(res, 403, { error: "Requests from a browser are not taken here." });
    handle(req, res).catch((error: unknown) => {
      const refused = error instanceof Refused;
      if (res.headersSent) return void res.end();
      json(res, refused ? error.status : 500, { error: refused ? error.message : `The sandbox failed: ${said(error)}` });
    });
  });

  const sockets = new WebSocketServer({ noServer: true });
  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (fromBrowser(req)) return void socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    if (url.pathname !== TERMINAL_PATH) return void socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
    sockets.handleUpgrade(req, socket, head, (ws) => {
      openTerminal(ws, url).catch(() => ws.close(1011, "The terminal could not be opened."));
    });
  });

  return new Promise((done, failed) => {
    http.once("error", failed);
    http.listen(port, host, () => {
      http.off("error", failed);
      tend();
      const address = http.address();
      done({
        port: address !== null && typeof address === "object" ? address.port : port,
        close: () =>
          new Promise<void>((closed) => {
            tending = false;
            for (const ws of sockets.clients) ws.terminate();
            for (const job of jobs) job.signal("SIGKILL");
            http.closeAllConnections();
            http.close(() => closed());
          }),
      });
    });
  });
}
