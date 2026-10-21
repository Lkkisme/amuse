/**
 * The sandbox's control daemon: Amuse's way to work inside its own machine.
 * It runs as the sandbox's normal user and listens on the sandbox network
 * only; the one other thing on that network is the Amuse server, and whatever
 * runs here is the same principal anyway, so it asks for no token.
 *
 * A command is a process group of its own: run to completion (output kept
 * within bounds, a timeout, stopped if the asker goes away) or kept as a
 * service (its recent output to read, stopped as a whole). Whatever a command
 * leaves running when it ends is stopped with it: what should go on running
 * is a service. Reset stops everything and empties the home folder back to
 * its skeleton, never touching the workspace.
 */
import { execFile, spawn } from "node:child_process";
import { cpSync, existsSync, statSync } from "node:fs";
import { lstat, readdir, rm } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { Clip, lastLines } from "./output.ts";
import { DEFAULT_TIMEOUT, Run, type Service, Start } from "./protocol.ts";

export interface Options {
  /** the user's home: emptied by a reset */
  home: string;
  /** the folder shared with Amuse (inside home): where commands start, and never emptied */
  workspace: string;
  /** what a fresh home holds (/etc/skel) */
  skeleton: string;
  port: number;
  host: string;
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

const sudo = promisify(execFile);

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

const said = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What was wrong with a request, as a sentence. */
const wrong = (error: z.ZodError) => error.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ");

export function serve({ home, workspace, skeleton, port, host, settle = 1_000 }: Options): Promise<Listening> {
  /** Everything started and not yet ended, so a reset or a shutdown can stop it. */
  const jobs = new Set<Job>();

  /** `command` in a bash of its own, in `cwd`, its output going to `clip`. */
  const launch = (command: string, cwd: string, clip: Clip): Job => {
    const child = spawn("bash", ["-c", command], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: home } });
    const group = child.pid;
    const signal = (name: NodeJS.Signals) => {
      if (group === undefined) return;
      try {
        process.kill(-group, name);
      } catch {
        // the group is gone already
      }
    };
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (text: string) => clip.append(text));
    }
    // what the command leaves running goes with it (and its pipes close)
    child.once("exit", () => signal("SIGKILL"));
    const ended = new Promise<End>((done, failed) => {
      child.once("error", failed);
      child.once("close", (exitCode, by) => done({ exitCode, signal: by }));
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
    command: s.command,
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
      job: launch(request.command, cwd, clip),
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
    return { service: describe(service), output: lastLines(clip.result().output, 40) };
  };

  const stop = async (ref: string) => {
    const service = find(ref);
    if (service.end === null) {
      service.job.stop(5_000);
      await service.job.ended.catch(() => {});
    }
    return { service: describe(service) };
  };

  const log = (ref: string, lines: number) => {
    const service = find(ref);
    const { output, cut } = service.clip.result();
    return { service: describe(service), output: lastLines(output, lines), cut };
  };

  /* ---------- reset ---------- */

  /** Delete `path` for good; what the user's own account may not (made by root with sudo) goes by sudo. */
  const remove = async (path: string) => {
    try {
      await rm(path, { recursive: true, force: true });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && (error.code === "EACCES" || error.code === "EPERM"))) throw error;
      await sudo("sudo", ["-n", "rm", "-rf", "--one-file-system", "--", path]).catch(() => {
        throw new Refused(`${path} could not be removed.`, 500);
      });
    }
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

  const reset = async () => {
    const stopping = [...jobs];
    for (const job of stopping) job.signal("SIGKILL");
    await Promise.allSettled(stopping.map((job) => job.ended));
    services.clear();
    await empty(home, workspace, (await lstat(home)).dev);
    if (existsSync(skeleton)) cpSync(skeleton, home, { recursive: true, force: true });
  };

  /* ---------- http ---------- */

  const json = (res: ServerResponse, status: number, value: unknown) =>
    void res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(value));

  const body = async (req: IncomingMessage): Promise<unknown> => {
    let text = "";
    for await (const chunk of req) {
      text += String(chunk);
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
    const route = `${req.method} /${path.map((part, i) => (i === 1 ? ":service" : part)).join("/")}`;
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
      case "POST /reset":
        await reset();
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
