import assert from "node:assert/strict";
import { test } from "node:test";
import { consequential } from "./policy.ts";

test("reading is free; sending, changing, deleting and paying are asked about", () => {
  for (const slug of ["GMAIL_FETCH_EMAILS", "GOOGLECALENDAR_LIST_EVENTS", "GITHUB_GET_REPO", "GOOGLESHEETS_BATCH_GET"]) assert.equal(consequential(slug), false, slug);
  for (const slug of ["GMAIL_SEND_EMAIL", "GOOGLECALENDAR_CREATE_EVENT", "GITHUB_MERGE_PULL_REQUEST", "SLACK_DELETE_MESSAGE", "GOOGLESHEETS_BATCH_UPDATE"])
    assert.equal(consequential(slug), true, slug);
});
