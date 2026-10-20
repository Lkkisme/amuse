import assert from "node:assert/strict";
import { test } from "node:test";
import { type Action, type Controller, type Observation, StaleRef, browserPool, controller } from "./index.ts";

/** A controller over a scripted page: a link and a search box, both pages share ids. */
function fakeController(log: string[] = []): Controller {
  let url = "https://a.example/";
  const page = (): Observation => ({
    url,
    title: "A",
    text_excerpt: "hello",
    interactables: [
      { element_id: "op-link", tag: "a", role: "link", label: "Next", type: null, href: "https://b.example/", disabled: false, checked: null },
      { element_id: "op-box", tag: "input", role: "textbox", label: "Search", type: "text", href: null, disabled: false, checked: null },
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
      if (action.name === "click" && action.body.element_id === "op-link") url = "https://b.example/";
      return { before, after: page() };
    },
    screenshot: async () => new Uint8Array([1, 2, 3]),
    saveProfile: async () => void log.push("save"),
    delete: async (s) => void log.push(`delete ${s}`),
    live: async () => [],
  };
}

test("refs come from the latest look; a page change retires them; unknown refs are refused", async () => {
  const pool = browserPool([{ name: "n1", controller: fakeController(), vnc: "ws://n1/websockify" }]);
  await pool.open("r1", "https://a.example/");
  const view = await pool.look("r1");
  assert.deepEqual(view.elements.map((e) => [e.ref, e.role, e.label]), [["e1", "link", "Next"], ["e2", "textbox", "Search"]]);
  await assert.rejects(pool.step("r1", { kind: "click", ref: "e9" }), StaleRef);
  await pool.step("r1", { kind: "click", ref: "e1" }); // navigates to b.example
  await assert.rejects(pool.step("r1", { kind: "type", ref: "e2", text: "x", submit: false }), StaleRef);
  const again = await pool.look("r1");
  assert.equal(again.elements[1]?.ref, "e2"); // the same element keeps its ref
  await pool.step("r1", { kind: "type", ref: "e2", text: "x", submit: false });
});

test("typing nothing clears the field; submit presses Enter; navigate checks the URL", async () => {
  const log: string[] = [];
  const pool = browserPool([{ name: "n1", controller: fakeController(log), vnc: "ws://n1/websockify" }]);
  await pool.open("r1", "https://a.example/");
  await pool.look("r1");
  await pool.step("r1", { kind: "type", ref: "e2", text: "", submit: true });
  assert.deepEqual(log.slice(-4), ['click {"element_id":"op-box"}', 'press {"key":"Control+a"}', 'press {"key":"Delete"}', 'press {"key":"Enter"}']);
  await assert.rejects(pool.step("r1", { kind: "navigate", url: "file:///etc/passwd" }), /not an http/);
});

test("a busy pool queues runs; a stopped waiter leaves the queue; closing hands the node on", async () => {
  const log: string[] = [];
  const pool = browserPool([{ name: "n1", controller: fakeController(log), vnc: "ws://n1/websockify" }]);
  await pool.open("first", "https://a.example/");
  let second = false;
  const waiting = pool.open("second", "https://a.example/").then(() => (second = true));
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
    seen.push(`${init?.method} ${url.pathname} ${new Headers(init?.headers).get("authorization")}`);
    if (url.pathname === "/sessions") return Response.json({ id: "abc123", status: "active", live: true });
    return Response.json({ url: "https://a.example/", title: "A", text_excerpt: null, interactables: [] });
  };
  const c = controller("http://ctl:8000", "tok", http);
  assert.equal(await c.create("https://a.example/", null), "abc123");
  assert.deepEqual(await c.observe("abc123"), { url: "https://a.example/", title: "A", text_excerpt: null, interactables: [] });
  assert.deepEqual(seen, ["POST /sessions Bearer tok", "POST /sessions/abc123/observe Bearer tok"]);
  await assert.rejects(controller("http://ctl:8000", "tok", async () => Response.json({ nope: 1 })).create("https://a.example/", null), /unexpected shape/);
});

// Against a real pool when one is running (mise run dev starts it): REMUSE_TEST_BROWSER=http://127.0.0.1:18101|<token>
const real = process.env["REMUSE_TEST_BROWSER"];
test("a real auto-browser node opens, looks, acts and closes", { skip: !real }, async () => {
  const [base = "", token = ""] = (real ?? "").split("|");
  const pool = browserPool([{ name: "real", controller: controller(base, token), vnc: "" }]);
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
});
