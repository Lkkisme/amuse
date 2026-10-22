import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createLocalSearch, loadLocalSearchConfig, LocalSearchConfigSchema } from "./local-search.ts";

const config = LocalSearchConfigSchema.parse({ provider: "searxng", url: "http://127.0.0.1:8889" });
const json = (value: unknown): typeof fetch => async () => Response.json(value);

test("local search is opt-in, validates the file, and rejects remote or credentialed services", () => {
  const dir = mkdtempSync(join(tmpdir(), "amuse-search-"));
  const file = join(dir, "search.json");
  try {
    assert.equal(loadLocalSearchConfig(file), null);
    writeFileSync(file, JSON.stringify({ provider: "searxng", url: "http://127.0.0.1:8889" }));
    assert.equal(loadLocalSearchConfig(file)?.maxResults, 8);
    for (const url of ["https://example.com", "http://127.0.0.1@evil.test", "http://owner:secret@localhost:8889", "file:///tmp/search", "http://localhost:8889/?key=x"]) {
      assert.equal(LocalSearchConfigSchema.safeParse({ provider: "searxng", url }).success, false, url);
    }
    writeFileSync(file, "{}");
    assert.throws(() => loadLocalSearchConfig(file));
  } finally { rmSync(dir, { recursive: true }); }
});

test("a Chinese query is POSTed to the local JSON API, results are normalized, deduplicated and bounded", async () => {
  const http: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://127.0.0.1:8889/search");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    const form = new URLSearchParams(String(init?.body));
    assert.equal(form.get("q"), "千问 官方 文档");
    assert.equal(form.get("format"), "json");
    assert.equal(form.get("language"), "all");
    return Response.json({ results: [
      { title: "<b>千问</b> &amp; 文档", url: "https://qwen.ai/#docs", content: "开源 <b>模型</b>\n文档" },
      { title: "Duplicate", url: "https://qwen.ai/", content: "" },
      { title: "Bad", url: "javascript:alert(1)", content: "" },
      { title: "Other", url: "https://example.org/", content: null },
      { title: "Private credential", url: "https://owner:secret@example.org/" },
    ] });
  };
  assert.deepEqual(await createLocalSearch({ ...config, maxResults: 2 }, http)("  千问 官方 文档  "), [
    { title: "千问 & 文档", url: "https://qwen.ai/", snippet: "开源 模型 文档" },
    { title: "Other", url: "https://example.org/", snippet: "" },
  ]);
});

test("engine outages, non-JSON data and disabled JSON give actionable failures without fabricating no-results", async () => {
  await assert.rejects(createLocalSearch(config, json({ results: [], unresponsive_engines: [["google", "timeout"]] }))("query"), /search engines failed/);
  await assert.rejects(createLocalSearch(config, json({ not: "search" }))("query"), /unexpected response/);
  await assert.rejects(createLocalSearch(config, async () => new Response("private details", { status: 403 }))("query"), /search.formats/);
  await assert.rejects(createLocalSearch(config, async () => new Response("secret", { status: 302, headers: { location: "https://example.org/" } }))("query"), /HTTP 302/);
  assert.deepEqual(await createLocalSearch(config, json({ results: [] }))("no hits"), []);
});

test("search has bounded response size and concurrency, and releases capacity after an error", async () => {
  await assert.rejects(createLocalSearch(config, async () => new Response("x".repeat(2_000_001)))("query"), /oversized/);
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => { finish = resolve; });
  const search = createLocalSearch(config, async () => { await waiting; return Response.json({ results: [] }); });
  const first = search("first");
  const second = search("second");
  await assert.rejects(search("third"), /busy/);
  finish();
  await Promise.all([first, second]);
  assert.deepEqual(await search("again"), []);
  let calls = 0;
  const retry = createLocalSearch(config, async () => { if (!calls++) throw new Error("sensitive proxy URL"); return Response.json({ results: [] }); });
  await assert.rejects(retry("query"), (error: unknown) => error instanceof Error && !error.message.includes("sensitive"));
  assert.deepEqual(await retry("query"), []);
});
