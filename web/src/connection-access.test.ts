import assert from "node:assert/strict";
import { test } from "node:test";
import type { Connection, Entity } from "@amuse/protocol";
import { connectionNeedsAppsKey, isLocalConnection } from "./connection-access.ts";

const connection = (id: string, provider: string): Connection => ({ kind: "connection", id, at: "2026-10-22T00:00:00Z", provider, title: provider, status: "pending" });
const entities: Entity[] = [connection("local-card", "local-github"), connection("mail-card", "gmail"), connection("calendar-card", "googlecalendar"), connection("cloud-github-card", "github")];

test("a known local GitHub card can connect without a cloud key or external OAuth tab", () => {
  assert.equal(isLocalConnection(entities, "local-card"), true);
  assert.equal(connectionNeedsAppsKey(entities, "local-card", true), false);
});

test("Gmail, Calendar and cloud GitHub retain the cloud key guide until configured", () => {
  for (const id of ["mail-card", "calendar-card", "cloud-github-card"]) {
    assert.equal(isLocalConnection(entities, id), false);
    assert.equal(connectionNeedsAppsKey(entities, id, true), true);
    assert.equal(connectionNeedsAppsKey(entities, id, false), false);
  }
});

test("closing a sheet stays a close action; a missing card never gains local access", () => {
  assert.equal(connectionNeedsAppsKey(entities, null, true), false);
  assert.equal(isLocalConnection(entities, "removed-card"), false);
  assert.equal(connectionNeedsAppsKey(entities, "removed-card", true), true);
  assert.equal(connectionNeedsAppsKey([], "local-card", true), true);
});
