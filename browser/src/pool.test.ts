import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type Action,
  type BrowserSessions,
  type Controller,
  type Observation,
  type Size,
  BrowserLost,
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

/**
 * A controller over a scripted page: a link and a search box, both pages share ids. `sessions`
 * holds the sessions it has live (the same set given to a second controller is a restart), and
 * `desktop` the pages its browser has open.
 */
interface Desktop {
  /** the pages open in the browser, in the order they were opened */
  pages: { url: string }[];
  /** which page the session drives (-1: the one it drove was closed, and it is not among them) */
  active: number;
  /** the browser is gone (its context with it): every call on the session fails, as the controller answers */
  gone?: Error;
  /** the controller no longer has the session (it restarted): every call on it is a 404 */
  restarted?: boolean;
  /** a step that fails for its own reason, with the page still there */
  refuses?: Error;
}

function fakeController(log: string[] = [], sessions = new Set<string>(), desktop: Desktop = { pages: [{ url: "https://a.example/" }], active: 0 }): Controller {
  const page = (): Observation => ({
    url: desktop.pages[desktop.active]?.url ?? "",
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
  /** What the controller answers when the session, or the browser, is not there. */
  const reachable = () => {
    if (desktop.gone) throw desktop.gone;
    if (desktop.restarted) throw new ControllerError("GET /sessions/s1 failed (404)", 404);
  };
  /** A call on the page the session drives: one that was closed fails as the controller's does (a 500). */
  const onPage = <T>(call: () => T): T => {
    reachable();
    if (desktop.active < 0) throw new ControllerError("the page the session drove was closed", 500);
    return call();
  };
  let made = 0;
  return {
    create: async (start) => {
      reachable();
      desktop.pages = [{ url: start }];
      desktop.active = 0;
      const session = `s${++made}`;
      sessions.add(session);
      return session;
    },
    observe: async () => onPage(() => page()),
    act: async (_, action: Action) => {
      reachable();
      if (desktop.refuses) throw desktop.refuses;
      if (desktop.active < 0) throw new ControllerError("the page the session drove was closed", 500);
      const current = desktop.pages[desktop.active];
      if (!current) throw new ControllerError("the page the session drove was closed", 500);
      log.push(`${action.name} ${JSON.stringify(action.body)}`);
      const before = current.url;
      if (action.name === "navigate") current.url = action.body.url;
      if (action.name === "click" && action.body.element_id === "op-link") current.url = "https://b.example/";
      return { before, after: page() };
    },
    screenshot: async () => onPage(() => new Uint8Array([1, 2, 3])),
    saveProfile: async () => void log.push("save"),
    profileSites: async () => [{ site: "facebook.com", cookies: 3 }],
    forgetProfileSite: async (_, site) => void log.push(`forget ${site}`),
    clearSessionSite: async (session, site) => void log.push(`clear ${session} ${site}`),
    delete: async (s) => void (log.push(`delete ${s}`), sessions.delete(s)),
    live: async () => [...sessions],
    downloads: async () =>
      onPage(() => [
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
      ]),
    artifact: async (u) => new TextEncoder().encode(`bytes of ${u}`),
    pages: async () => {
      reachable();
      return desktop.pages.map((open, index) => ({ index, active: index === desktop.active, url: open.url }));
    },
    activatePage: async (_, index) => void (log.push(`activate ${index}`), (desktop.active = index)),
    openPage: async (_, url) => void (log.push(`open ${url ?? "about:blank"}`), desktop.pages.push({ url: url ?? "about:blank" }), (desktop.active = desktop.pages.length - 1)),
  };
}

/** The browsers kept open, in memory: the database one is api/src/browser-sessions.ts. */
function keptSessions(): BrowserSessions {
  const rows = new Map<string, { id: string; node: string; session: string }>();
  return {
    list: () => [...rows.values()],
    save: (id, node, session) => void rows.set(id, { id, node, session }),
    forget: (id) => void rows.delete(id),
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

test("a restart takes up the browsers whose session is still there, closes the ones whose session is gone, and closes strays", async () => {
  const log: string[] = [];
  const sessions = keptSessions();
  // what each controller has live: the same set given to a second client is the same controller after a restart
  const one = new Set<string>();
  const two = new Set<string>();
  const node = (name: string, live: Set<string>) => ({ name, controller: fakeController(log, live), vnc: `ws://${name}/websockify` });
  // a node is leased from the end of the pool's list: "kept" is on n2, "gone" on n1
  const before = browserPool([node("n1", one), node("n2", two)], { desktop: sizes(), sessions });
  await before.open("kept", "https://a.example/");
  await before.open("gone", "https://a.example/");
  assert.deepEqual(
    sessions.list().map((row) => [row.id, row.node, row.session]),
    [
      ["kept", "n2", "s1"],
      ["gone", "n1", "s1"],
    ],
    "each open browser is kept with its node and session",
  );
  // the controller restarted meanwhile: one session is gone, and one from an earlier run is left behind
  one.delete("s1");
  two.add("s9");

  const after = browserPool([node("n1", one), node("n2", two)], { desktop: sizes(), sessions });
  // "older" is a browser the state still lists as open that was opened before this was kept at all
  const { adopted, lost, closed } = await after.reconcile(["kept", "gone", "older"]);
  assert.deepEqual(adopted, ["kept"], "a session that is still there is taken up again");
  assert.deepEqual(lost, [
    { id: "gone", reason: "its browser session is gone" },
    { id: "older", reason: "no session is kept for it" },
  ]);
  assert.equal(closed, 1);
  assert.ok(log.includes("delete s9"), "a session no browser owns is closed");
  assert.deepEqual(sessions.list().map((row) => row.id), ["kept"], "and what was lost is forgotten");
  // what is adopted works as before: its preview, its live view and its page
  assert.equal(after.vnc("kept"), "ws://n2/websockify");
  assert.ok(await after.screenshot("kept"));
  assert.equal((await after.look("kept")).url, "https://a.example/");
  assert.equal(await after.screenshot("gone"), null, "a browser whose session is gone has no preview");
  assert.equal(after.vnc("gone"), null);
  await after.close("kept");
  assert.deepEqual(sessions.list(), [], "closing a browser forgets it too");
});

test("a controller that does not answer is left as it is: nothing there is adopted, closed or called lost", async () => {
  const sessions = keptSessions();
  const pool = browserPool(
    [{ name: "n1", controller: fakeController([], new Set(["s1"])), vnc: "ws://n1/websockify" }],
    { desktop: sizes(), sessions },
  );
  sessions.save("b1", "n1", "s1");
  const reachable = await pool.reconcile(["b1"]);
  assert.deepEqual([reachable.adopted, reachable.lost], [["b1"], []]);
  // the same browser, with the controller out of reach: its card stays as it is, and its row is kept
  const away = browserPool(
    [{ name: "n1", controller: { ...fakeController(), live: async () => Promise.reject(new Error("fetch failed")) }, vnc: "ws://n1/websockify" }],
    { desktop: sizes(), sessions },
  );
  // b2 has no row at all (it was opened before any of this was kept), so it is closed whatever the controllers say
  assert.deepEqual(await away.reconcile(["b1", "b2"]), { adopted: [], lost: [{ id: "b2", reason: "no session is kept for it" }], closed: 0 });
  assert.deepEqual(sessions.list().map((row) => row.id), ["b1"], "and b1's row is kept, to be adopted at the next start");
  assert.deepEqual(sessions.list().map((row) => row.id), ["b1"]);
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

// Against a real pool when one is running (mise run dev starts it): AMUSE_TEST_BROWSER=http://127.0.0.1:18101|<token>
const real = process.env["AMUSE_TEST_BROWSER"];
test(
  "a real auto-browser node opens, looks, acts and closes",
  { skip: !real },
  async () => {
    const [base = "", token = ""] = (real ?? "").split("|");
    const pool = browserPool([
      { name: "real", controller: controller(base, token), vnc: "" },
    ]);
    await pool.reconcile([]);
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
  const local = mkdtempSync(join(tmpdir(), "amuse-handoff-"));
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

test("a session the controller no longer has is not open; one whose page was closed is left to the recovery; an unanswered controller is not taken for either", async () => {
  const desktop: Desktop = { pages: [{ url: "https://a.example/" }], active: 0 };
  const pool = browserPool(
    [{ name: "n1", controller: fakeController([], new Set(), desktop), vnc: "ws://n1/websockify" }],
    { desktop: sizes() },
  );
  await pool.open("r1", "https://a.example/");
  assert.equal(await pool.stillOpen("r1"), true);
  // the page it drove was closed: the run is left to take one up again, not closed
  desktop.pages = [];
  desktop.active = -1;
  assert.equal(await pool.stillOpen("r1"), true);
  // the controller restarted, or its browser was closed: the session is gone
  desktop.restarted = true;
  assert.equal(await pool.stillOpen("r1"), false);
  desktop.restarted = false;
  // a controller that does not answer is not taken for that
  desktop.gone = new Error("fetch failed");
  assert.equal(await pool.stillOpen("r1"), true);
  delete desktop.gone;
  assert.equal(await pool.stillOpen("nope"), false);});

test("a page that was closed is taken up again: another page of the browser, or a fresh one at the last URL", async () => {
  const log: string[] = [];
  const desktop: Desktop = { pages: [], active: -1 };
  const pool = browserPool(
    [{ name: "n1", controller: fakeController(log, new Set(), desktop), vnc: "ws://n1/websockify" }],
    { desktop: sizes() },
  );
  await pool.open("r1", "https://a.example/");
  assert.equal((await pool.look("r1")).url, "https://a.example/");
  // the user closed that tab, and the browser has another page open (a window they opened)
  desktop.pages = [{ url: "https://b.example/" }];
  desktop.active = -1;
  const taken = await pool.look("r1");
  assert.deepEqual(log.filter((line) => line.startsWith("activate")), ["activate 0"], "the most recent page is taken up");
  assert.equal(taken.url, "https://b.example/");
  assert.match(taken.note ?? "", /page this task was on was closed; it is on another page/);
  assert.equal((await pool.look("r1")).note, undefined, "the agent is told once");
  // and with no page left at all, a fresh one opens in the same browser, at the URL the run was on
  desktop.pages = [];
  desktop.active = -1;
  const opened = await pool.look("r1");
  assert.deepEqual(log.filter((line) => line.startsWith("open")), ["open https://b.example/"], "at the last URL the run was on");
  assert.equal(opened.url, "https://b.example/");
  assert.match(opened.note ?? "", /page this task was on was closed; a new one is open at https:\/\/b\.example\//);
});

test("a browser that is gone is said so, and no page is invented", async () => {
  const desktop: Desktop = { pages: [], active: -1 };
  const pool = browserPool(
    [{ name: "n1", controller: fakeController([], new Set(), desktop), vnc: "ws://n1/websockify" }],
    { desktop: sizes() },
  );
  await pool.open("r1", "https://a.example/");
  // the window was closed with its context: the session is there, and nothing of it answers
  desktop.gone = new ControllerError("Target page, context or browser has been closed", 500);
  await assert.rejects(pool.look("r1"), BrowserLost);
  await assert.rejects(pool.step("r1", { kind: "press", key: "Enter" }), BrowserLost);
  assert.equal(await pool.screenshot("r1"), null, "a preview that cannot be had is no error");
  await assert.rejects(pool.downloads("r1"), BrowserLost, "the agent is told, so its task can end");
});

test("a step that fails with the page still there is not taken for a page that was closed", async () => {
  const log: string[] = [];
  const desktop: Desktop = { pages: [{ url: "https://a.example/" }], active: 0 };
  const pool = browserPool(
    [{ name: "n1", controller: fakeController(log, new Set(), desktop), vnc: "ws://n1/websockify" }],
    { desktop: sizes() },
  );
  await pool.open("r1", "https://a.example/");
  desktop.refuses = new ControllerError("the field is not there", 500);
  await assert.rejects(pool.step("r1", { kind: "press", key: "Enter" }), /the field is not there/);
  assert.deepEqual(log.filter((line) => /^(activate|open) /.test(line)), [], "nothing is taken up or opened");
  assert.equal((await pool.look("r1")).note, undefined);
});

test("the sites logins are kept for are listed; forgetting one takes it from what is kept and signs every open browser out of it", async () => {
  const log: string[] = [];
  const pool = browserPool([{ name: "n1", controller: fakeController(log), vnc: "ws://n1/websockify" }], { desktop: sizes() });
  assert.deepEqual(await pool.logins(), [{ site: "facebook.com", cookies: 3 }]);
  await pool.open("r1", "https://a.example/");
  await pool.forgetLogin("facebook.com");
  assert.ok(log.includes("forget facebook.com"));
  assert.ok(log.some((line) => /^clear \S+ facebook\.com$/.test(line)), "the open browser is signed out too");
});
