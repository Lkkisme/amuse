import assert from "node:assert/strict";
import { test } from "node:test";
import { holds, sameLine } from "./badge.ts";
import type { AgentLine } from "./view.ts";

const tool: AgentLine = { icon: "tool", text: "Re-observing page" };
const other: AgentLine = { icon: "tool", text: "Searching the web" };
const responding: AgentLine = { icon: "list", text: "is responding" };
const approval: AgentLine = { icon: "approval", text: "Needs approval" };

test("only a tool's line giving way to the generic responding one is held", () => {
  assert.equal(holds(tool, responding), true);
  assert.equal(holds(tool, other), false);
  assert.equal(holds(tool, null), false);
  assert.equal(holds(tool, approval), false);
  assert.equal(holds(responding, tool), false);
  assert.equal(holds(null, responding), false);
  assert.equal(holds(approval, responding), false);
});

test("lines are the same by what they show, not by identity", () => {
  assert.equal(sameLine(tool, { ...tool }), true);
  assert.equal(sameLine(tool, other), false);
  assert.equal(sameLine(null, null), true);
  assert.equal(sameLine(tool, null), false);
});
