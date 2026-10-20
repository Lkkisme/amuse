import assert from "node:assert/strict";
import { test } from "node:test";
import { consequential } from "./policy.ts";

test("only plain reads are free; writes and anything unclear are asked about", () => {
  for (const slug of ["GMAIL_FETCH_EMAILS", "GOOGLECALENDAR_LIST_EVENTS", "GITHUB_GET_REPO", "GOOGLESHEETS_BATCH_GET", "GOOGLECALENDAR_EVENTS_LIST"]) assert.equal(consequential(slug), false, slug);
  for (const slug of ["GMAIL_SEND_EMAIL", "GOOGLECALENDAR_CREATE_EVENT", "GITHUB_MERGE_PULL_REQUEST", "SLACK_DELETE_MESSAGE", "GOOGLESHEETS_BATCH_UPDATE", "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL", "GMAIL_MODIFY_THREAD_LABELS", "GOOGLEDRIVE_UPLOAD_FILE", "NOTION_SOMETHING_NEW", "UNITED_CHECK_IN"])
    assert.equal(consequential(slug), true, slug);
});
