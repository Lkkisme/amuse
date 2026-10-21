/**
 * The sandbox's control daemon: Amuse's way to work inside its own machine.
 * It listens on the sandbox network only; the one other thing on that network
 * is the Amuse server, and whatever runs here can already do all it can ask
 * (the user has sudo), so it asks for no token. It runs as root, so that it
 * can always stop what it started and clean up after it, but every command it
 * starts runs as the normal user (`user`), never as root unless it says sudo.
 *
 * A command is a process group of its own: run to completion (output kept
 * within bounds, a timeout, stopped if the asker goes away) or kept as a
 * service (its recent output to read, stopped as a whole). A command is over
 * when its own process is; whatever it left running in its group is stopped
 * with it (what should go on running is a service), and a process that got
 * away (setsid, a daemon) no longer holds the answer back. Reset stops
 * everything and empties the home folder back to its skeleton, never touching
 * the workspace.
 *
 * Credentials the user gave for the sandbox (through the Amuse server, never
 * the agent) are kept here: as environment variables every command gets (a
 * file of them, the user's only), or as files of the user's in the home
 * folder; and a service can be typed into (a CLI waiting for a code).
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, readFileSync, statSync } from "node:fs";
import { chmod, lchown, lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { Clip, endOf, lastLines } from "./output.ts";
import { DEFAULT_TIMEOUT, Forget, Input, Run, SecretEnv, SecretFile, type Service, Start } from "./protocol.ts";

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
  /** how long a service just started is watched for an early end before it is reported (ms) */
  settle?: number;
}

/** A running daemon: where it listens, and how to stop it (what it runs too). */
export interface Listening {
  port: number;
  close(): Promise<void>;
}

/** Output of a command that runs to completion: how much is kept at each end. */
const FIRST = 6_000;
const LAST = 24_000;
/** A service's output kept for reading, and the lines a look at it gives by default and at most. */
const KEPT = 200_000;
const LINES = 100;
const MOST_LINES = 1_000;
/** Services running at once, and ended ones remembered (for their logs). */
const RUNNING = 10;
const REMEMBERED = 20;
/** Largest request taken. */
const MAX_BODY = 1024 ** 2;
/** A long command is kept from looking idle to whoever waits for it. */
const BEAT_MS = 20_000;
/** After a command's process ends, how long its output is still waited for, from pipes something else may hold open. */
const GRACE_MS = 300;

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
  /** type into it (a service only: a command's input is empty); false when it takes no more */
  type(text: string): boolean;
}

const said = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What was wrong with a request, as a sentence. */
const wrong = (error: z.ZodError) => error.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ");

export function serve({ home, workspace, skeleton, port, host, user, isolated = false, settle = 1_000 }: Options): Promise<Listening> {
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

  /** `command` in a bash of its own, in `cwd`, its output going to `clip`; a service's input stays open to type into. */
  const launch = (command: string, cwd: string, clip: Clip, typed = false): Job => {
    const child = spawn("bash", ["-c", command], {
      cwd,
      detached: true,
      stdio: [typed ? "pipe" : "ignore", "pipe", "pipe"],
      env: { ...environment, ...secrets() },
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
    // both are pipes (the stdio above); only the input is left out for a command
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
      type: (text) => {
        const input = child.stdin;
        if (!input || input.destroyed || !input.writable) return false;
        input.write(text);
        return true;
      },
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

  /* ---------- services ---------- */

  interface Kept {
    id: string;
    name: string;
    command: string;
    cwd: string;
    startedAt: string;
    clip: Clip;
    job: Job;
    end: End | null;
  }
  const services = new Map<string, Kept>();
  let counter = 0;

  const describe = (s: Kept): Service => ({
    id: s.id,
    name: s.name,
    // only the start of it: a long command is no reason for a long answer
    command: s.command.slice(0, 200),
    cwd: s.cwd,
    startedAt: s.startedAt,
    running: s.end === null,
    exitCode: s.end?.exitCode ?? null,
    signal: s.end?.signal ?? null,
  });

  /** A service by id or name (a name: the one running, else the latest). */
  const find = (ref: string): Kept => {
    const all = [...services.values()];
    const found = all.find((s) => s.id === ref) ?? all.findLast((s) => s.name === ref && s.end === null) ?? all.findLast((s) => s.name === ref);
    if (!found) throw new Refused(`There is no service ${ref}. The ones there are: ${all.map((s) => s.name).join(", ") || "none"}.`, 404);
    return found;
  };

  const start = async (request: Start) => {
    const running = [...services.values()].filter((s) => s.end === null);
    const clash = running.find((s) => s.name === request.name);
    if (clash) throw new Refused(`A service called ${request.name} is running already; stop it first or choose another name.`, 409);
    if (running.length >= RUNNING) throw new Refused(`${RUNNING} services are running; stop one first.`, 409);
    const cwd = folder(request.cwd);
    const clip = new Clip(0, KEPT);
    const service: Kept = {
      id: `s${++counter}`,
      name: request.name,
      command: request.command,
      cwd,
      startedAt: new Date().toISOString(),
      clip,
      job: launch(request.command, cwd, clip, true),
      end: null,
    };
    service.job.ended.then(
      (end) => void (service.end = end),
      (error) => {
        clip.append(`Could not start the command: ${said(error)}`);
        service.end = { exitCode: null, signal: null };
      },
    );
    services.set(service.id, service);
    // the oldest ended ones go, past what is remembered
    const ended = [...services.values()].filter((s) => s.end !== null);
    for (const old of ended.slice(0, Math.max(0, ended.length - REMEMBERED))) services.delete(old.id);
    // a command that fails at once shows it now
    await Promise.race([service.job.ended.catch(() => {}), new Promise((done) => setTimeout(done, settle))]);
    return { service: describe(service), output: endOf(lastLines(clip.result().output, 40)) };
  };

  const stop = async (ref: string) => {
    const service = find(ref);
    if (service.end === null) {
      service.job.stop(5_000);
      await service.job.ended.catch(() => {});
    }
    return { service: describe(service) };
  };

  /** A line typed into a running service: what a waiting CLI reads (a code), never kept here. */
  const type = (ref: string, text: string) => {
    const service = find(ref);
    if (service.end !== null || !service.job.type(`${text}\n`)) throw new Refused(`The service ${service.name} is not running, or takes no input.`, 409);
    return {};
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
  const keep = async (path: string, text: string) => {
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

  const setFile = async ({ path, value }: SecretFile) => {
    await keep(homePath(path), value);
    return {};
  };

  const forget = async (what: Forget) => {
    if ("env" in what) {
      const rest = Object.fromEntries(Object.entries(secrets()).filter(([name]) => name !== what.env));
      await keep(secretsFile, JSON.stringify(rest));
    } else await rm(homePath(what.file), { force: true });
    return {};
  };

  const log = (ref: string, lines: number) => {
    const service = find(ref);
    const { output, cut } = service.clip.result();
    return { service: describe(service), output: endOf(lastLines(output, lines)), cut };
  };

  /* ---------- reset ---------- */

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
    await stopAll();
    services.clear();
    await empty(home, workspace, (await lstat(home)).dev);
    if (existsSync(skeleton)) {
      cpSync(skeleton, home, { recursive: true, force: true });
      for (const name of await readdir(skeleton)) await give(join(home, name));
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
    // a service's name or id is the part after /services
    const route = `${req.method} /${path.map((part, i) => (i === 1 && path[0] === "services" ? ":service" : part)).join("/")}`;
    if (resetting && route !== "POST /reset") await resetting.catch(() => {});
    switch (route) {
      case "GET /health":
        return json(res, 200, {});
      case "POST /run":
        return await run(await asked(req, Run), res);
      case "POST /services":
        return json(res, 200, await start(await asked(req, Start)));
      case "GET /services":
        return json(res, 200, { services: [...services.values()].map(describe) });
      case "GET /services/:service/log": {
        const lines = Number(url.searchParams.get("lines") ?? LINES);
        return json(res, 200, log(path[1] ?? "", Number.isInteger(lines) && lines > 0 ? Math.min(lines, MOST_LINES) : LINES));
      }
      case "POST /services/:service/stop":
        return json(res, 200, await stop(path[1] ?? ""));
      case "POST /services/:service/input":
        return json(res, 200, type(path[1] ?? "", (await asked(req, Input)).text));
      case "POST /secrets/env":
        return json(res, 200, await setEnv(await asked(req, SecretEnv)));
      case "POST /secrets/file":
        return json(res, 200, await setFile(await asked(req, SecretFile)));
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
    handle(req, res).catch((error: unknown) => {
      const refused = error instanceof Refused;
      if (res.headersSent) return void res.end();
      json(res, refused ? error.status : 500, { error: refused ? error.message : `The sandbox failed: ${said(error)}` });
    });
  });

  return new Promise((done, failed) => {
    http.once("error", failed);
    http.listen(port, host, () => {
      http.off("error", failed);
      const address = http.address();
      done({
        port: address !== null && typeof address === "object" ? address.port : port,
        close: () =>
          new Promise<void>((closed) => {
            for (const job of jobs) job.signal("SIGKILL");
            http.closeAllConnections();
            http.close(() => closed());
          }),
      });
    });
  });
}
