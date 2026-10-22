import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { WebSocket } from "ws";
import { sandboxClient } from "./client.ts";
import { type Listening, serve } from "./daemon.ts";

const root = mkdtempSync(join(tmpdir(), "amuse-terminal-test-"));
const home = join(root, "home");
const workspace = join(home, "workspace");
const skeleton = join(root, "skel");
/** herdr as far as the daemon can tell: `server` puts its socket and stays; otherwise an interface that says its size and echoes lines. */
const herdr = join(root, "herdr");
let daemon: Listening;

before(async () => {
  mkdirSync(workspace, { recursive: true });
  mkdirSync(skeleton);
  writeFileSync(
    herdr,
    `#!/usr/bin/env bash
if [ "$1" = server ]; then
  mkdir -p "$HOME/.config/herdr" && touch "$HOME/.config/herdr/herdr.sock" && echo started >> "$HOME/starts" && echo $$ > "$HOME/server.pid"
  exec sleep 1000
fi
echo "pid $$"; stty size
while IFS= read -r line; do if [ "$line" = size ]; then stty size; else echo "got $line"; fi; done
`,
  );
  chmodSync(herdr, 0o755);
  daemon = await serve({ home, workspace, skeleton, port: 0, host: "127.0.0.1", herdr });
});
after(() => daemon.close());

const until = async (done: () => boolean, ms = 8_000) => {
  for (const start = Date.now(); !done() && Date.now() - start < ms; ) await new Promise((r) => setTimeout(r, 25));
  return done();
};
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const starts = () => (existsSync(join(home, "starts")) ? readFileSync(join(home, "starts"), "utf8").split("\n").filter(Boolean).length : 0);

/** A viewer: what the terminal has shown so far (line ends as the terminal makes them, \r\n). */
const open = async (query: string) => {
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/terminal${query}`);
  let shown = "";
  ws.on("message", (data: Buffer, binary: boolean) => {
    if (binary) shown += data.toString("utf8");
  });
  await new Promise((done, failed) => ws.once("open", done).once("error", failed));
  return { ws, shown: () => shown.replaceAll("\r", "") };
};

test("herdr's server is kept running: started with the daemon, and again when it ends", async () => {
  assert.ok(await until(() => starts() === 1));
  const sockets = join(home, ".config", "herdr", "herdr.sock");
  assert.ok(existsSync(sockets));
  // the server stops
  process.kill(Number(readFileSync(join(home, "server.pid"), "utf8")), "SIGTERM");
  assert.ok(await until(() => starts() === 2));
});

test("a terminal shows herdr's interface at the viewer's size, takes what is typed, and follows a resize", async () => {
  const { ws, shown } = await open("?cols=100&rows=30");
  assert.ok(await until(() => shown().includes("30 100")), shown());
  ws.send(Buffer.from("hello\n"));
  assert.ok(await until(() => shown().includes("got hello")), shown());
  ws.send(JSON.stringify({ type: "resize", cols: 50, rows: 10 }));
  // what is not a resize, or out of bounds, is ignored
  ws.send(JSON.stringify({ type: "resize", cols: 5000, rows: 10 }));
  ws.send("not json");
  ws.send(Buffer.from("size\n"));
  assert.ok(await until(() => shown().includes("10 50")), shown());
  assert.ok(!shown().includes("10 5000"));

  // the viewer leaves: the interface goes (what herdr runs would not)
  const pid = Number(/pid (\d+)/.exec(shown())?.[1]);
  assert.ok(alive(pid));
  ws.close();
  assert.ok(await until(() => !alive(pid)));
});

test("an interface that ends closes the viewer's socket; only /terminal upgrades", async () => {
  const { ws } = await open("");
  const closed = new Promise<number>((done) => ws.once("close", done));
  ws.send(Buffer.from("\u0004")); // end of input: the interface's loop ends
  assert.equal(await closed, 1000);
  const elsewhere = new WebSocket(`ws://127.0.0.1:${daemon.port}/run`);
  await new Promise((done) => elsewhere.once("error", done));
});

test("a reset stops the terminals and herdr's server, empties home, and starts the server again", async () => {
  const { ws } = await open("");
  const closed = new Promise((done) => ws.once("close", done));
  await sandboxClient(`http://127.0.0.1:${daemon.port}`).reset();
  await closed;
  // home was emptied, so the count starts over
  assert.ok(await until(() => starts() === 1));
});

test("a credential is typed into a terminal through herdr's socket, with Enter; not into a shell at its prompt; herdr's refusal comes back in words", async () => {
  const { createServer } = await import("node:net");
  const own = mkdtempSync(join(tmpdir(), "amuse-type-test-"));
  const ownHome = join(own, "home");
  mkdirSync(join(ownHome, "workspace"), { recursive: true });
  mkdirSync(join(ownHome, ".config", "herdr"), { recursive: true });
  // herdr's server is the test's own socket here; the binary only has to stay up
  const idle = join(own, "herdr");
  writeFileSync(idle, "#!/usr/bin/env bash\nexec sleep 1000\n");
  chmodSync(idle, 0o755);
  const asked: unknown[] = [];
  const socket = createServer((connection) => {
    connection.setEncoding("utf8");
    connection.on("data", (line: string) => {
      const request = JSON.parse(line);
      asked.push(request);
      const pane = request.params.pane_id;
      // w1:p2 runs a login (its own process group), w1:p3 is at the shell's prompt
      const running = { pane_id: pane, shell_pid: 100, foreground_process_group_id: pane === "w1:p3" ? 100 : 200, foreground_processes: [] };
      connection.write(
        pane === "w9:p9"
          ? `${JSON.stringify({ id: request.id, error: { code: "pane_not_found", message: "no pane w9:p9" } })}\n`
          : `${JSON.stringify({ id: request.id, result: request.method === "pane.process_info" ? { type: "process_info", process_info: running } : { type: "ok" } })}\n`,
      );
    });
  });
  await new Promise<void>((done) => socket.listen(join(ownHome, ".config", "herdr", "herdr.sock"), done));
  const typing = await serve({ home: ownHome, workspace: join(ownHome, "workspace"), skeleton: join(own, "skel"), port: 0, host: "127.0.0.1", herdr: idle });
  try {
    const client = sandboxClient(`http://127.0.0.1:${typing.port}`);
    await client.typeSecret({ pane: "w1:p2", value: "code-123" });
    assert.deepEqual(asked, [
      { id: "amuse", method: "pane.process_info", params: { pane_id: "w1:p2" } },
      { id: "amuse", method: "pane.send_input", params: { pane_id: "w1:p2", text: "code-123", keys: ["enter"] } },
    ]);
    await assert.rejects(client.typeSecret({ pane: "w1:p3", value: "late-code" }), (e: unknown) => e instanceof Error && "detail" in e && /shell prompt/.test(String(e.detail)));
    assert.ok(!asked.some((a) => JSON.stringify(a).includes("late-code")), "nothing typed into the shell");
    await assert.rejects(client.typeSecret({ pane: "w9:p9", value: "x" }), (e: unknown) => e instanceof Error && "detail" in e && /no pane w9:p9/.test(String(e.detail)));
    // not a pane's id: refused before herdr is asked
    const before = asked.length;
    await assert.rejects(client.typeSecret({ pane: "w1:p2; rm", value: "x" }));
    assert.equal(asked.length, before);
  } finally {
    await typing.close();
    socket.close();
  }
});

test("a terminal opened with no workspace in herdr opens one in the workspace folder; with one there, nothing is made", async () => {
  const { createServer } = await import("node:net");
  const own = mkdtempSync(join(tmpdir(), "amuse-first-test-"));
  const ownHome = join(own, "home");
  const ownWorkspace = join(ownHome, "workspace");
  mkdirSync(ownWorkspace, { recursive: true });
  mkdirSync(join(ownHome, ".config", "herdr"), { recursive: true });
  const idle = join(own, "herdr");
  writeFileSync(idle, "#!/usr/bin/env bash\nexec sleep 1000\n");
  chmodSync(idle, 0o755);
  const asked: { method: string; params: unknown }[] = [];
  let workspaces: unknown[] = [];
  const socket = createServer((connection) => {
    connection.setEncoding("utf8");
    connection.on("data", (line: string) => {
      const { id, method, params } = JSON.parse(line);
      asked.push({ method, params });
      if (method === "workspace.create") workspaces = [{ workspace_id: "w1" }];
      connection.write(`${JSON.stringify({ id, result: method === "workspace.list" ? { type: "workspace_list", workspaces } : { type: "ok" } })}\n`);
    });
  });
  await new Promise<void>((done) => socket.listen(join(ownHome, ".config", "herdr", "herdr.sock"), done));
  const first = await serve({ home: ownHome, workspace: ownWorkspace, skeleton: join(own, "skel"), port: 0, host: "127.0.0.1", herdr: idle });
  const view = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${first.port}/terminal`);
    await new Promise((done, failed) => ws.once("open", done).once("error", failed));
    return ws;
  };
  try {
    const one = await view();
    assert.ok(await until(() => asked.some((a) => a.method === "workspace.create")));
    assert.deepEqual(asked, [
      { method: "workspace.list", params: {} },
      { method: "workspace.create", params: { cwd: ownWorkspace, label: "workspace", focus: true } },
    ]);
    one.close();
    const two = await view();
    assert.ok(await until(() => asked.length === 3));
    assert.equal(asked[2]?.method, "workspace.list");
    two.close();
  } finally {
    await first.close();
    socket.close();
  }
});

test("a viewer that leaves while the daemon waits for herdr's server leaves nothing running, and holds no slot", async () => {
  const own = mkdtempSync(join(tmpdir(), "amuse-wait-test-"));
  const ownHome = join(own, "home");
  mkdirSync(join(ownHome, "workspace"), { recursive: true });
  // a server whose socket comes late; an interface that says it started
  const slow = join(own, "herdr");
  writeFileSync(
    slow,
    `#!/usr/bin/env bash
if [ "$1" = server ]; then sleep 0.4; mkdir -p "$HOME/.config/herdr" && touch "$HOME/.config/herdr/herdr.sock"; exec sleep 1000; fi
echo started >> "$HOME/interfaces"; exec sleep 1000
`,
  );
  chmodSync(slow, 0o755);
  const waiting = await serve({ home: ownHome, workspace: join(ownHome, "workspace"), skeleton: join(own, "skel"), port: 0, host: "127.0.0.1", herdr: slow });
  try {
    const open = () => new WebSocket(`ws://127.0.0.1:${waiting.port}/terminal`);
    // eight leave at once, before the server is there
    const leaving = Array.from({ length: 8 }, open);
    await Promise.all(leaving.map((ws) => new Promise((done) => ws.once("open", done))));
    for (const ws of leaving) ws.close();
    await new Promise((done) => setTimeout(done, 1_000));
    assert.equal(existsSync(join(ownHome, "interfaces")), false, "an interface was started for a viewer that had left");
    // the slots are free: one more opens, and a ninth at once is turned away
    const views = Array.from({ length: 9 }, open);
    const codes = await Promise.all(
      views.map(
        (ws) =>
          new Promise<number | "open">((done) => {
            ws.once("close", (code) => done(code));
            setTimeout(() => done("open"), 1_500);
          }),
      ),
    );
    assert.equal(codes.filter((c) => c === 4429).length, 1, String(codes));
    assert.equal(codes.filter((c) => c === "open").length, 8, String(codes));
    for (const ws of views) ws.close();
  } finally {
    await waiting.close();
  }
});
