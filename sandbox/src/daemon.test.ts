import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { type SandboxClient, SandboxError, sandboxClient } from "./client.ts";
import { type Listening, serve } from "./daemon.ts";

const root = mkdtempSync(join(tmpdir(), "amuse-sandbox-test-"));
const home = join(root, "home");
const workspace = join(home, "workspace");
const skeleton = join(root, "skel");
let daemon: Listening;
let sandbox: SandboxClient;

before(async () => {
  mkdirSync(workspace, { recursive: true });
  mkdirSync(skeleton);
  writeFileSync(join(skeleton, ".profile"), "# fresh\n");
  daemon = await serve({ home, workspace, skeleton, port: 0, host: "127.0.0.1", settle: 300 });
  sandbox = sandboxClient(`http://127.0.0.1:${daemon.port}`);
});
after(() => daemon.close());

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (done: () => boolean, ms = 5_000) => {
  for (const start = Date.now(); !done() && Date.now() - start < ms;) await new Promise((r) => setTimeout(r, 25));
  return done();
};
const failure = (call: Promise<unknown>) =>
  call.then(
    () => assert.fail("it should have been refused"),
    (e: unknown) => (e instanceof SandboxError ? e.message : assert.fail(String(e))),
  );

test("a command runs to completion in the workspace, both streams in one, with how it ended", async () => {
  const ran = await sandbox.run({ command: "pwd; echo out; echo err >&2; exit 3" });
  assert.deepEqual(ran, { output: `${workspace}\nout\nerr\n`, cut: 0, exitCode: 3, signal: null, timedOut: false });
  mkdirSync(join(workspace, "sub"));
  assert.equal((await sandbox.run({ command: "pwd", cwd: "sub" })).output.trim(), join(workspace, "sub"));
  assert.equal((await sandbox.run({ command: "echo $HOME" })).output.trim(), home);
});

test("a command without a folder to run in, or an unsound request, is refused in words", async () => {
  assert.match(await failure(sandbox.run({ command: "ls", cwd: "nowhere" })), /no folder nowhere/);
  assert.match(await failure(sandbox.run({ command: "ls", timeout: 100_000 })), /timeout/);
  assert.match(await failure(sandbox.run({ command: "" })), /command/);
});

test("a command that runs too long is stopped, with what it printed", async () => {
  const ran = await sandbox.run({ command: "echo started; sleep 30", timeout: 1 });
  assert.equal(ran.timedOut, true);
  assert.equal(ran.output, "started\n");
  assert.equal(ran.exitCode, null);
});

test("output is clipped in the middle, and says how much was left out", async () => {
  const ran = await sandbox.run({ command: "echo first; head -c 200000 /dev/zero | tr '\\0' x; echo last" });
  assert.ok(ran.cut > 100_000, String(ran.cut));
  assert.ok(ran.output.length < 40_000);
  assert.match(ran.output, /^first\n/);
  assert.match(ran.output, /characters left out/);
  assert.match(ran.output, /last\n$/);
});

test("what a command leaves running goes when it ends", async () => {
  const ran = await sandbox.run({ command: "sleep 60 & echo $!" });
  const pid = Number(ran.output.trim());
  assert.ok(await until(() => !alive(pid)), "the leftover process is still there");
});

test("a command is stopped when whoever asked for it goes away", async () => {
  const file = join(root, "pid");
  const asking = new AbortController();
  const running = sandbox.run({ command: `echo $$ > ${file}; sleep 60`, timeout: 60 }, asking.signal);
  assert.ok(await until(() => existsSync(file) && readFileSync(file, "utf8").endsWith("\n")));
  const pid = Number(readFileSync(file, "utf8"));
  assert.ok(alive(pid));
  asking.abort();
  await running.catch(() => {});
  assert.ok(await until(() => !alive(pid)), "the command goes on");
});

test("a service runs on, its output can be read, and stopping it stops the whole group", async () => {
  const file = join(root, "service-pids");
  const { service, output } = await sandbox.start({ name: "ticker", command: `(sleep 60 & echo $! >> ${file}; while true; do echo tick; sleep 0.2; done)` });
  assert.equal(service.running, true);
  assert.match(output, /^tick/, "what it printed in its first moments comes with it");
  assert.match(await failure(sandbox.start({ name: "ticker", command: "sleep 1" })), /running already/);
  assert.ok(await until(() => existsSync(file)));
  const child = Number(readFileSync(file, "utf8"));
  assert.ok(alive(child));
  const seen = await sandbox.log("ticker", 3);
  assert.match(seen.output, /^(tick\n?){1,3}$/);
  assert.equal((await sandbox.log(service.id, 1)).service.id, service.id);
  assert.deepEqual(
    (await sandbox.services()).map((s) => [s.name, s.running]),
    [["ticker", true]],
  );

  const stopped = await sandbox.stop("ticker");
  assert.equal(stopped.running, false);
  assert.ok(await until(() => !alive(child)), "the service's child is still there");
  assert.match((await sandbox.log("ticker")).output, /tick/, "its log is still there to read");
  // the name is free again
  await sandbox.stop((await sandbox.start({ name: "ticker", command: "sleep 30" })).service.id);
});

test("a service that fails at once says so in what it printed", async () => {
  const { service, output } = await sandbox.start({ name: "broken", command: "echo cannot bind port; exit 3" });
  assert.equal(service.running, false);
  assert.equal(service.exitCode, 3);
  assert.equal(output, "cannot bind port");
  assert.match(await failure(sandbox.log("nothing")), /no service nothing/);
});

test("a reset stops everything and empties the home folder to its skeleton, never the workspace", async () => {
  writeFileSync(join(workspace, "mine.txt"), "keep");
  mkdirSync(join(workspace, "deep"));
  mkdirSync(join(home, ".cache/tool"), { recursive: true });
  writeFileSync(join(home, ".cache/tool/x"), "x");
  writeFileSync(join(home, ".profile"), "changed");
  writeFileSync(join(home, "notes.txt"), "n");
  const outside = join(root, "outside.txt");
  writeFileSync(outside, "not the sandbox's");
  symlinkSync(root, join(home, "link-out"));
  const { service } = await sandbox.start({ name: "web", command: "sleep 60" });

  await sandbox.reset();

  assert.deepEqual(readdirSync(home).sort(), [".profile", "workspace"]);
  assert.equal(readFileSync(join(home, ".profile"), "utf8"), "# fresh\n");
  assert.equal(readFileSync(join(workspace, "mine.txt"), "utf8"), "keep");
  assert.ok(existsSync(join(workspace, "deep")));
  assert.equal(readFileSync(outside, "utf8"), "not the sandbox's", "a link out of the home is removed, not followed");
  assert.deepEqual(await sandbox.services(), []);
  assert.match(await failure(sandbox.stop(service.id)), /no service/);
});

test("when the daemon cannot be reached, the client says so in words", async () => {
  const gone = sandboxClient("http://127.0.0.1:1");
  assert.match(await failure(gone.reset()), /cannot be reached/);
});
