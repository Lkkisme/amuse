import assert from "node:assert/strict";
import { test } from "node:test";
import { type Entry, type Ports, type Workspace, createHost, memoryRules, noKeys, noLogins, noSandbox, noSecrets, noWorkspace } from "@amuse/core";
import { agentBrief, agentTools } from "./agent.ts";

function fixture() {
  const saved = new Map<string, Uint8Array>();
  const files: Workspace = {
    ...noWorkspace,
    exists: async (path) => saved.has(path) || [...saved.keys()].some((p) => p.startsWith(`${path}/`)),
    open: async (path) => {
      const data = saved.get(path);
      if (!data) throw new Error(`no ${path}`);
      return { path, data, size: data.length, type: "text/markdown" };
    },
    write: async (path, data) => void saved.set(path, data),
    list: async (folder) => {
      const names = new Set([...saved.keys()].filter((p) => p.startsWith(`${folder}/`)).map((p) => p.slice(folder.length + 1).split("/")[0]!));
      return [...names].map((name): Entry => { const path = `${folder}/${name}`; return { path, kind: saved.has(path) ? "file" : "folder", size: saved.get(path)?.length ?? 0, modified: "" }; });
    },
  };
  const notes: string[] = [];
  const ports: Ports = {
    files, keys: noKeys, rules: memoryRules(), logins: noLogins, sandbox: noSandbox, secrets: noSecrets,
    prompt: (turn) => { if (turn.kind === "message") assert.fail("shared tools must not start a Pi model"); notes.push(turn.text); },
    interrupt: () => {}, title: async () => "", browse: () => {}, job: () => {}, task: () => {}, schedule: () => {},
    browser: () => {}, approval: () => {}, stopTask: () => {}, fit: () => {}, connect: async () => "",
    apps: { search: async () => ({ apps: [], cursor: null }), accounts: async () => [], connect: async () => "", access: async () => ({ kind: "managed" }), cannotConnect: async () => null, connectKey: async () => {}, disconnect: async () => {}, permissions: async () => [], permit: async () => {} },
  };
  const host = createHost(ports, { clock: { now: () => "2026-10-21T08:00:00Z" }, timers: { set: () => 0, clear: () => {} } });
  const cfg = { files, rules: ports.rules, skills: [{ name: "fixture", description: "Read the integration fixture", body: "Use the fixture.", from: "built in" }] };
  const available = agentTools(cfg, () => host.agent("main"));
  const call = async (name: string, args: Record<string, unknown>) => {
    const tool = available.find((t) => t.name === name);
    assert.ok(tool, name);
    // Amuse's shared tools close over AgentIO and do not consume a Pi context.
    return tool.execute("harness-call", args, undefined, undefined, {} as Parameters<typeof tool.execute>[4]);
  };
  return { files, saved, host, cfg, call, notes, available };
}

test("an external harness uses Amuse memory, skills and goals without opening a Pi session", async () => {
  const { saved, host, cfg, call, available } = fixture();
  assert.ok(!available.some((t) => t.name === "no_reply"), "external harnesses own their turn completion");
  await call("remember", { status: "Remembering", section: "Preferences", text: "Reply in Chinese", source: "the user" });
  const goal = await host.call("goals.add", { title: "Learn Japanese", about: "Study a little every day." });
  assert.ok(goal.id);
  const brief = await agentBrief(cfg);
  assert.match(brief, /Reply in Chinese/);
  assert.match(brief, /Learn Japanese/);
  assert.match(brief, /fixture: Read the integration fixture/);
  assert.match(JSON.stringify(await call("use_skill", { status: "Reading", name: "fixture" })), /Use the fixture/);
  assert.match(new TextDecoder().decode(saved.get("memory/MEMORY.md")), /Reply in Chinese/);
  await call("schedule", { status: "Scheduling", title: "Practice", instructions: "Practice Japanese", at: "2027-01-01 08:00", timezone: "UTC", goal: goal.id });
  const { schedules } = await host.call("schedules.list", {});
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0]?.goal, goal.id);
});

test("forget from an external harness still requires the normal user approval", async () => {
  const { saved, host, call, notes } = fixture();
  await call("remember", { status: "Remembering", section: "Facts", text: "Fixture fact", source: "the user" });
  const result = await call("forget", { status: "Forgetting", memory: "Fixture fact", why: "the user asked to remove it" });
  assert.match(JSON.stringify(result), /NOT forgotten yet/);
  assert.match(new TextDecoder().decode(saved.get("memory/MEMORY.md")), /Fixture fact/);
  const { approvals } = await host.call("approvals.list", {});
  assert.equal(approvals.length, 1);
  await host.call("approval.resolve", { id: approvals[0]!.approval.id, resolution: "allow_once" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.doesNotMatch(new TextDecoder().decode(saved.get("memory/MEMORY.md")), /Fixture fact/);
  assert.match(notes[0] ?? "", /Forgotten, as the user confirmed/);
});
