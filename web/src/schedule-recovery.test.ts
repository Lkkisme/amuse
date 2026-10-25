import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium, type Page } from "playwright-core";

const edge = process.env["AMUSE_TEST_EDGE"] ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

interface Fixture {
  snapshot(): { reads: number; controls: { id: string; action: string }[]; listeners: number };
  rejectRead(kind: "dropped" | "refused"): void;
  resolveRead(withSchedule?: boolean | "paused"): void;
  resolveControl(): void;
  rejectControl(kind: "dropped" | "refused"): void;
  emit(kind: "chats" | "reset"): void;
  unmount(): void;
}
declare global { interface Window { scheduleFixture: Fixture } }

/** Actual React component, with deferred RPCs and no production server, credentials or model. */
const fixture = `
import {createRoot} from "react-dom/client";
import {Schedules} from "./components/Schedules.tsx";
import {Dropped,CallFailed} from "@amuse/api/client";
import {setChoice} from "./i18n/language.ts";
setChoice("en");
let reads=0;
const controls=[],pendingReads=[],pendingControls=[],listeners=new Set();
const schedule={kind:"schedule",id:"test-schedule",at:"2026-10-24T00:00:00Z",title:"Test schedule",instructions:"Read only fixture",when:{kind:"once",at:"2030-01-01T00:00:00Z"},status:"active",next:"2030-01-01T00:00:00Z",running:false,last:null,needs:null,preset:false,goal:null};
const session={
 call(method,params){
  if(method==="schedules.list"){reads++;return new Promise((resolve,reject)=>pendingReads.push({resolve,reject}));}
  if(method==="schedule.control"){controls.push(params);return new Promise((resolve,reject)=>pendingControls.push({resolve,reject}));}
  throw Error("Unexpected RPC: "+method);
 },
 subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}
};
const root=createRoot(document.getElementById("root"));
window.scheduleFixture={
 snapshot:()=>({reads,controls,listeners:listeners.size}),
 rejectRead:kind=>pendingReads.shift().reject(kind==="dropped"?new Dropped("Connection lost"):new CallFailed("Read denied",-32000)),
 resolveRead:withSchedule=>pendingReads.shift().resolve({schedules:withSchedule?[{...schedule,status:withSchedule==="paused"?"paused":"active"}]:[]}),
 resolveControl:()=>pendingControls.shift().resolve({}),
 rejectControl:kind=>pendingControls.shift().reject(kind==="dropped"?new Dropped("Control outcome unknown"):new CallFailed("Control denied",-32000)),
 emit:kind=>{for(const listener of listeners)listener(kind==="chats"?{kind:"chats",chats:[]}:{kind:"reset",chat:"main",state:{}});},
 unmount:()=>root.unmount()
};
root.render(<Schedules session={session}/>);
`;

async function reads(page: Page, count: number) {
  await page.waitForFunction((expected) => window.scheduleFixture.snapshot().reads === expected, count);
}
async function flush(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

test("Schedules recovers a mounted page after transport retries are exhausted", { skip: !existsSync(edge), timeout: 45_000 }, async (t) => {
  const bundle = await build({
    stdin: { contents: fixture, resolveDir: fileURLToPath(new URL("./", import.meta.url)), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' }, logLevel: "silent",
  });
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  t.after(() => browser.close());
  const open = async () => {
    const context = await browser.newContext();
    await context.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    const page = await context.newPage();
    page.setDefaultTimeout(2_000);
    await page.goto("http://schedule-fixture.invalid/");
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await reads(page, 1);
    return { page, close: () => context.close() };
  };

  await t.test("a successful chats update retries an exhausted read, even without a session reset", async () => {
    const f = await open();
    try {
      await f.page.evaluate(() => window.scheduleFixture.rejectRead("dropped"));
      await f.page.getByRole("alert").waitFor();
      // This is what a heartbeat or successful reconnect provides when sync has no new events.
      await f.page.evaluate(() => window.scheduleFixture.emit("chats"));
      await reads(f.page, 2);
      await f.page.evaluate(() => window.scheduleFixture.resolveRead());
      await f.page.getByText("No schedules yet.", { exact: true }).waitFor();
      assert.equal(await f.page.getByRole("alert").count(), 0);
      await f.page.evaluate(() => { for (let n = 0; n < 4; n++) window.scheduleFixture.emit("chats"); });
      await flush(f.page);
      assert.equal(await f.page.evaluate(() => window.scheduleFixture.snapshot().reads), 2, "healthy heartbeats do not poll the page");
    } finally { await f.close(); }
  });

  await t.test("concurrent refreshes share one read and another exhausted attempt can recover later", async () => {
    const f = await open();
    try {
      await f.page.evaluate(() => { window.scheduleFixture.emit("reset"); window.scheduleFixture.emit("reset"); });
      await flush(f.page);
      assert.equal(await f.page.evaluate(() => window.scheduleFixture.snapshot().reads), 1, "no overlapping reads");
      await f.page.evaluate(() => window.scheduleFixture.rejectRead("dropped"));
      await f.page.getByRole("alert").waitFor();
      await f.page.evaluate(() => { window.scheduleFixture.emit("chats"); window.scheduleFixture.emit("chats"); });
      await reads(f.page, 2);
      await f.page.evaluate(() => window.scheduleFixture.rejectRead("dropped"));
      await flush(f.page);
      await f.page.evaluate(() => window.scheduleFixture.emit("chats"));
      await reads(f.page, 3);
      await f.page.evaluate(() => window.scheduleFixture.resolveRead());
      await f.page.getByText("No schedules yet.", { exact: true }).waitFor();
      assert.equal(await f.page.getByRole("alert").count(), 0);
    } finally { await f.close(); }
  });

  await t.test("a server refusal does not become a heartbeat retry loop", async () => {
    const f = await open();
    try {
      await f.page.evaluate(() => window.scheduleFixture.rejectRead("refused"));
      await f.page.getByText("Read denied", { exact: true }).waitFor();
      await f.page.evaluate(() => { for (let n = 0; n < 5; n++) window.scheduleFixture.emit("chats"); });
      await flush(f.page);
      assert.equal(await f.page.evaluate(() => window.scheduleFixture.snapshot().reads), 1);
    } finally { await f.close(); }
  });

  await t.test("a control completing during an old read gets one fresh read afterwards", async () => {
    const f = await open();
    try {
      await f.page.evaluate(() => window.scheduleFixture.resolveRead(true));
      await f.page.getByRole("button", { name: "Pause", exact: true }).waitFor();
      await f.page.evaluate(() => window.scheduleFixture.emit("reset"));
      await reads(f.page, 2);
      await f.page.getByRole("button", { name: "Pause", exact: true }).click();
      await f.page.evaluate(() => { window.scheduleFixture.resolveControl(); window.scheduleFixture.emit("reset"); });
      await flush(f.page);
      assert.equal(await f.page.evaluate(() => window.scheduleFixture.snapshot().reads), 2, "one read at a time");
      await f.page.evaluate(() => window.scheduleFixture.resolveRead(true));
      await reads(f.page, 3);
      await f.page.evaluate(() => window.scheduleFixture.resolveRead("paused"));
      await f.page.getByRole("button", { name: "Resume", exact: true }).waitFor();
      assert.deepEqual(await f.page.evaluate(() => window.scheduleFixture.snapshot().controls), [{ id: "test-schedule", action: "pause" }]);
    } finally { await f.close(); }
  });

  await t.test("leaving the page detaches recovery and ignores an in-flight completion", async () => {
    const f = await open();
    try {
      await f.page.evaluate(() => window.scheduleFixture.unmount());
      await f.page.evaluate(() => { window.scheduleFixture.rejectRead("dropped"); window.scheduleFixture.emit("chats"); });
      await flush(f.page);
      assert.deepEqual(await f.page.evaluate(() => window.scheduleFixture.snapshot()), { reads: 1, controls: [], listeners: 0 });
      assert.equal(await f.page.locator("#root").textContent(), "");
    } finally { await f.close(); }
  });

  await t.test("a recovered read clears its old error without hiding a newer control refusal", async () => {
    const f = await open();
    try {
      await f.page.evaluate(() => window.scheduleFixture.resolveRead(true));
      await f.page.getByText("Test schedule", { exact: true }).waitFor();
      await f.page.evaluate(() => window.scheduleFixture.emit("reset"));
      await reads(f.page, 2);
      await f.page.evaluate(() => window.scheduleFixture.rejectRead("dropped"));
      await f.page.getByRole("alert").waitFor();
      await f.page.evaluate(() => window.scheduleFixture.emit("chats"));
      await reads(f.page, 3);
      await f.page.getByRole("button", { name: "Pause", exact: true }).click();
      await f.page.evaluate(() => window.scheduleFixture.rejectControl("refused"));
      await f.page.getByText("Control denied", { exact: true }).waitFor();
      await f.page.evaluate(() => window.scheduleFixture.resolveRead(true));
      await flush(f.page);
      assert.equal(await f.page.getByRole("alert").textContent(), "Control denied");
      await f.page.evaluate(() => { window.scheduleFixture.emit("chats"); window.scheduleFixture.emit("chats"); });
      await flush(f.page);
      assert.deepEqual(await f.page.evaluate(() => window.scheduleFixture.snapshot().controls), [{ id: "test-schedule", action: "pause" }]);
    } finally { await f.close(); }
  });

  for (const { status, button, action } of [
    { status: true, button: "Pause", action: "pause" },
    { status: "paused", button: "Resume", action: "resume" },
    { status: true, button: "Delete", action: "cancel" },
  ] as const) {
    await t.test(`an uncertain ${action} is not replayed when the list reconnects`, async () => {
      const f = await open();
      try {
        await f.page.evaluate((status) => window.scheduleFixture.resolveRead(status), status);
        await f.page.getByRole("button", { name: button, exact: true }).click();
        await f.page.evaluate(() => window.scheduleFixture.rejectControl("dropped"));
        await f.page.getByRole("alert").waitFor();
        await f.page.evaluate(() => { for (let n = 0; n < 4; n++) window.scheduleFixture.emit("chats"); });
        await flush(f.page);
        assert.deepEqual(await f.page.evaluate(() => window.scheduleFixture.snapshot().controls), [{ id: "test-schedule", action }]);
      } finally { await f.close(); }
    });
  }
});
