import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type Action,
  type Controller,
  type Observation,
  type Size,
  StaleRef,
  browserPool,
  controller,
  ControllerError,
} from "./index.ts";

/** Desktop sizes set, as "vnc WxH". */
const sizes =
  (log: string[] = []) =>
  async (vnc: string, { width, height }: Size) =>
    void log.push(`${vnc} ${width}x${height}`);

/** A controller over a scripted page: a link and a search box, both pages share ids. */
/** set to make the fake's window closed */
let closed = false;
/** set to make the fake's tab list fail */
let tabsFail: Error | null = null;
function fakeController(log: string[] = []): Controller {
  let url = "https://a.example/";
  const page = (): Observation => ({
    url,
    title: "A",
    text_excerpt: "hello",
    interactables: [
      {
        element_id: "op-link",
        tag: "a",
        role: "link",
        label: "Next",
        type: null,
        href: "https://b.example/",
        disabled: false,
        checked: null,
      },
      {
        element_id: "op-box",
        tag: "input",
        role: "textbox",
        label: "Search",
        type: "text",
        href: null,
        disabled: false,
        checked: null,
      },
    ],
  });
  let sessions = 0;
  return {
    create: async (start) => ((url = start), `s${++sessions}`),
    observe: async () => page(),
    act: async (_, action: Action) => {
      log.push(`${action.name} ${JSON.stringify(action.body)}`);
      const before = url;
      if (action.name === "navigate") url = action.body.url;
      if (action.name === "click" && action.body.element_id === "op-link")
        url = "https://b.example/";
      return { before, after: page() };
    },
    screenshot: async () => new Uint8Array([1, 2, 3]),
    saveProfile: async () => void log.push("save"),
    delete: async (s) => void log.push(`delete ${s}`),
    live: async () => [],
    downloads: async () => [
      {
        filename: "report.pdf",
        status: "completed",
        url: "/artifacts/s1/downloads/report.pdf",
      },
      {
        filename: "big.zip",
        status: "in_progress",
        url: "/artifacts/s1/downloads/big.zip",
      },
    ],
    artifact: async (u) => new TextEncoder().encode(`bytes of ${u}`),
    tabs: async () => {
      if (tabsFail) throw tabsFail;
      return closed ? 0 : 1;
    },
  };
}

test("refs come from the latest look; a page change retires them; unknown refs are refused", async () => {
  const pool = browserPool(
    [{ name: "n1", controller: fakeController(), vnc: "ws://n1/websockify" }],
    { desktop: sizes() },
  );
  await pool.open("r1", "https://a.example/");
  const view = await pool.look("r1");
  assert.deepEqual(
    view.elements.map((e) => [e.ref, e.role, e.label]),
    [
      ["e1", "link", "Next"],
      ["e2", "textbox", "Search"],
    ],
  );
  await assert.rejects(pool.step("r1", { kind: "click", ref: "e9" }), StaleRef);
  await pool.step("r1", { kind: "click", ref: "e1" }); // navigates to b.example
  await assert.rejects(
    pool.step("r1", { kind: "type", ref: "e2", text: "x", submit: false }),
    StaleRef,
  );
  const again = await pool.look("r1");
  assert.equal(again.elements[1]?.ref, "e2"); // the same element keeps its ref
  await pool.step("r1", { kind: "type", ref: "e2", text: "x", submit: false });
});

test("typing nothing clears the field; submit presses Enter; navigate checks the URL", async () => {
  const log: string[] = [];
  const pool = browserPool(
    [
      {
        name: "n1",
        controller: fakeController(log),
        vnc: "ws://n1/websockify",
      },
    ],
    { desktop: sizes() },
  );
  await pool.open("r1", "https://a.example/");
  await pool.look("r1");
  await pool.step("r1", { kind: "type", ref: "e2", text: "", submit: true });
  assert.deepEqual(log.slice(-4), [
    'click {"element_id":"op-box"}',
    'press {"key":"Control+a"}',
    'press {"key":"Delete"}',
    'press {"key":"Enter"}',
  ]);
  await assert.rejects(
    pool.step("r1", { kind: "navigate", url: "file:///etc/passwd" }),
    /not an http/,
  );
});

test("a busy pool queues runs; a stopped waiter leaves the queue; closing hands the node on", async () => {
  const log: string[] = [];
  const pool = browserPool(
    [
      {
        name: "n1",
        controller: fakeController(log),
        vnc: "ws://n1/websockify",
      },
    ],
    { desktop: sizes() },
  );
  await pool.open("first", "https://a.example/");
  let second = false;
  const waiting = pool
    .open("second", "https://a.example/")
    .then(() => (second = true));
  const stop = new AbortController();
  const third = pool.open("third", "https://a.example/", stop.signal);
  stop.abort();
  await assert.rejects(third, /stopped/);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(second, false);
  assert.equal(pool.vnc("second"), null);
  await pool.close("first");
  await waiting;
  assert.equal(second, true);
  assert.equal(pool.vnc("second"), "ws://n1/websockify");
  assert.ok(log.includes("delete s1"));
});

test("the controller client parses responses and sends the bearer token", async () => {
  const seen: string[] = [];
  const http: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    seen.push(
      `${init?.method} ${url.pathname} ${new Headers(init?.headers).get("authorization")}`,
    );
    if (url.pathname === "/sessions")
      return Response.json({ id: "abc123", status: "active", live: true });
    return Response.json({
      url: "https://a.example/",
      title: "A",
      text_excerpt: null,
      interactables: [],
    });
  };
  const c = controller("http://ctl:8000", "tok", http);
  assert.equal(await c.create("https://a.example/", null), "abc123");
  assert.deepEqual(await c.observe("abc123"), {
    url: "https://a.example/",
    title: "A",
    text_excerpt: null,
    interactables: [],
  });
  assert.deepEqual(seen, [
    "POST /sessions Bearer tok",
    "POST /sessions/abc123/observe Bearer tok",
  ]);
  await assert.rejects(
    controller("http://ctl:8000", "tok", async () =>
      Response.json({ nope: 1 }),
    ).create("https://a.example/", null),
    /unexpected shape/,
  );
});

// Against a real pool when one is running (mise run dev starts it): REMUSE_TEST_BROWSER=http://127.0.0.1:18101|<token>
const real = process.env["REMUSE_TEST_BROWSER"];
test(
  "a real auto-browser node opens, looks, acts and closes",
  { skip: !real },
  async () => {
    const [base = "", token = ""] = (real ?? "").split("|");
    const pool = browserPool([
      { name: "real", controller: controller(base, token), vnc: "" },
    ]);
    await pool.reset();
    await pool.open("r", "https://example.com/");
    const view = await pool.look("r");
    assert.equal(view.title, "Example Domain");
    const link = view.elements.find((e) => e.role === "link");
    assert.ok(link);
    await pool.step("r", { kind: "click", ref: link.ref });
    assert.notEqual((await pool.look("r")).url, "https://example.com/");
    const png = await pool.screenshot("r");
    assert.ok(png && png[0] === 0x89);
    await pool.close("r");
  },
);

test("a run starts at the standard desktop size; the user's screen reshapes it; handing back restores it", async () => {
  const set: string[] = [];
  const pool = browserPool(
    [{ name: "n1", controller: fakeController(), vnc: "ws://n1/websockify" }],
    { desktop: sizes(set) },
  );
  await pool.open("r1", "https://a.example/");
  await pool.fit("r1", { width: 390, height: 560 });
  await pool.fit("r1", null);
  assert.deepEqual(set, [
    "ws://n1/websockify 1024x768",
    "ws://n1/websockify 720x1034",
    "ws://n1/websockify 1024x768",
  ]);
  await assert.rejects(pool.fit("r9", null), /not open/);
});

test("an upload hands the controller only that file, in the shared folder, for as long as it takes", async () => {
  const local = mkdtempSync(join(tmpdir(), "remuse-handoff-"));
  const log: string[] = [];
  const base = fakeController(log);
  let seen = "";
  const controller: Controller = {
    ...base,
    act: async (session, action) => {
      if (action.name === "upload") {
        const file = join(
          local,
          action.body.file_path.replace("/data/uploads/", ""),
        );
        seen = `${readFileSync(file, "utf8")} ${(statSync(file).mode & 0o777).toString(8)}`;
      }
      return base.act(session, action);
    },
  };
  const pool = browserPool(
    [
      {
        name: "n1",
        controller,
        vnc: "ws://n1/websockify",
        handoff: { local, remote: "/data/uploads" },
      },
    ],
    { desktop: sizes() },
  );
  await pool.open("r1", "https://a.example/");
  const box = (await pool.look("r1")).elements.find(
    (e) => e.label === "Search",
  );
  assert.ok(box);
  await pool.upload("r1", box.ref, {
    name: "../../cv.pdf",
    data: new TextEncoder().encode("my cv"),
  });
  assert.equal(
    seen,
    "my cv 644",
    "the controller can read it while it uploads",
  );
  assert.ok(
    log.some((l) =>
      l.startsWith(
        'upload {"element_id":"op-box","file_path":"/data/uploads/r1/cv.pdf"',
      ),
    ),
    "a name is only a name",
  );
  assert.ok(!existsSync(join(local, "r1")), "and it is gone after");
  const bare = browserPool(
    [{ name: "n2", controller: fakeController(), vnc: "ws://n2/websockify" }],
    { desktop: sizes() },
  );
  await bare.open("r2", "https://a.example/");
  const field = (await bare.look("r2")).elements.find(
    (e) => e.label === "Search",
  );
  assert.ok(field);
  await assert.rejects(
    bare.upload("r2", field.ref, { name: "a.txt", data: new Uint8Array() }),
    /cannot take files/,
  );
});

test("finished downloads are handed over once each", async () => {
  const pool = browserPool(
    [{ name: "n1", controller: fakeController(), vnc: "ws://n1/websockify" }],
    { desktop: sizes() },
  );
  await pool.open("r1", "https://a.example/");
  const first = await pool.downloads("r1");
  assert.deepEqual(
    first.map((f) => [f.name, new TextDecoder().decode(f.data)]),
    [["report.pdf", "bytes of /artifacts/s1/downloads/report.pdf"]],
  );
  assert.deepEqual(await pool.downloads("r1"), []);
});

test("a run whose window the user closed is no longer open; an unanswered controller is not taken for that", async () => {
  const pool = browserPool(
    [{ name: "n1", controller: fakeController(), vnc: "ws://n1/websockify" }],
    { desktop: sizes() },
  );
  await pool.open("r1", "https://a.example/");
  assert.equal(await pool.stillOpen("r1"), true);
  closed = true;
  assert.equal(await pool.stillOpen("r1"), false);
  closed = false;
  assert.equal(await pool.stillOpen("nope"), false);
  tabsFail = new Error("fetch failed");
  assert.equal(await pool.stillOpen("r1"), true);
  tabsFail = new ControllerError("GET /sessions/x/tabs failed (404)", 404);
  assert.equal(await pool.stillOpen("r1"), false);
  tabsFail = null;
});
