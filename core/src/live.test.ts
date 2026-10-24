import assert from "node:assert/strict";
import { test } from "node:test";
import { duration, withJobs } from "./live.ts";

test("a span is told in the largest units that fit", () => {
  assert.deepEqual([5, 59, 60, 192, 3600, 3900, 7200].map(duration), ["5 s", "59 s", "1 min", "3 min 12 s", "1 h", "1 h 5 min", "2 h"]);
});

test("the background jobs are a line each under the heading of what is running, and nothing is added without any", () => {
  const now = "2026-10-23T08:03:12Z";
  const jobs = [{ id: "j3", command: "npm run build", since: "2026-10-23T08:00:00Z" }];
  assert.equal(withJobs("", [], now), "");
  assert.equal(withJobs("What is running now:\n- task", [], now), "What is running now:\n- task");
  assert.equal(withJobs("", jobs, now), 'What is running now:\n- job j3 "npm run build": running for 3 min 12 s, you are told when it ends');
  assert.equal(
    withJobs('What is running now:\n- task "x" (t-1): running (just now)', jobs, now),
    'What is running now:\n- task "x" (t-1): running (just now)\n- job j3 "npm run build": running for 3 min 12 s, you are told when it ends',
  );
});
