import assert from "node:assert/strict";
import { test } from "node:test";
import type { Toolkit } from "./client.ts";
import { composioDirectory, score } from "./directory.ts";

const tk = (slug: string, name: string, description = "", categories: string[] = []): Toolkit => ({ slug, name, description, logo: null, categories });
// in order of use, as Composio lists them
const all = [
  tk("gmail", "Gmail", "Google's email service"),
  tk("github", "GitHub", "Code hosting"),
  tk("googlecalendar", "Google Calendar", "Events and schedules"),
  tk("mailchimp", "Mailchimp", "Email marketing", ["email newsletters"]),
  tk("zoho_mail", "Zoho Mail", "Email hosting"),
  tk("notion", "Notion", "Notes and docs"),
];
const directory = (accounts: { id: string; toolkit: string; status: string; label: string | null }[] = []) =>
  composioDirectory(
    {
      toolkits: async () => all,
      accounts: async () => accounts,
      remove: async () => {},
      link: async (app) => ({ url: `https://connect.example/${app}`, account: "ca_new" }),
    },
    { userId: "owner" },
  );

test("a name match outranks a description match; within a rank, the most used first", async () => {
  const { apps } = await directory().search("mail", null);
  assert.deepEqual(apps.map((a) => a.id), ["gmail", "mailchimp", "zoho_mail"]);
  assert.equal(score(all[0]!, ["email"]), 1);
});

test("an empty query lists everything, most used first, a page at a time", async () => {
  const first = await directory().search("", null);
  assert.equal(first.apps[0]?.id, "gmail");
  assert.equal(first.cursor, null); // fewer than a page
});

test("every word must match", async () => {
  assert.deepEqual((await directory().search("google calendar", null)).apps.map((a) => a.id), ["googlecalendar"]);
  assert.deepEqual((await directory().search("google zzz", null)).apps, []);
});

test("accounts carry their app, and only settled ones show", async () => {
  const accounts = await directory([
    { id: "ca_1", toolkit: "gmail", status: "ACTIVE", label: "me@example.com" },
    { id: "ca_2", toolkit: "notion", status: "EXPIRED", label: null },
    { id: "ca_3", toolkit: "github", status: "INITIATED", label: null },
  ]).accounts();
  assert.deepEqual(accounts.map((a) => [a.id, a.app.name, a.label, a.status]), [["ca_1", "Gmail", "me@example.com", "active"], ["ca_2", "Notion", null, "expired"]]);
});
