import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryRules } from "@remuse/core";
import { pageText, privateAddress, readPage } from "./web.ts";

test("only the public internet is readable", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd7a:115c::1", "::ffff:10.0.0.1"]) assert.ok(privateAddress(ip), ip);
  for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"]) assert.ok(!privateAddress(ip), ip);
});

test("a page's text: no scripts, styles or tags; entities decoded; whitespace folded", () => {
  const { title, text } = pageText("<html><head><title>Tides &amp; times</title><style>p{}</style></head><body><script>alert(1)</script><h1>Low tide</h1><p>at 3:02&nbsp;pm</p></body></html>");
  assert.equal(title, "Tides & times");
  assert.equal(text, "Low tide\nat 3:02 pm");
});

/** A fetch over a few fixed answers, by URL. */
const answering = (pages: Record<string, { status: number; location?: string; body?: string }>): typeof fetch => async (input) => {
  const page = pages[String(input)];
  if (!page) return new Response("not here", { status: 404 });
  const headers: Record<string, string> = { "content-type": "text/html" };
  if (page.location) headers["location"] = page.location;
  return new Response(page.body ?? "", { status: page.status, headers });
};

test("this machine and private networks are not read, and neither are denied sites, redirects included", async () => {
  const rules = memoryRules();
  assert.match(await readPage("http://127.0.0.1:8000/sessions", rules), /not on the public web/);
  assert.match(await readPage("http://ab-controller-1:8000/", rules), /not on the public web/);
  await rules.setSite("1.1.1.1", "deny");
  const http = answering({ "http://93.184.216.34/": { status: 302, location: "http://1.1.1.1/secret" } });
  assert.match(await readPage("http://93.184.216.34/", rules, http), /does not allow 1\.1\.1\.1/);
  const toInside = answering({ "http://93.184.216.34/": { status: 301, location: "http://10.0.0.2/admin" } });
  assert.match(await readPage("http://93.184.216.34/", rules, toInside), /not on the public web/);
  const fine = answering({ "http://93.184.216.34/": { status: 200, body: "<title>Hi</title><p>Hello</p>" } });
  assert.equal(await readPage("http://93.184.216.34/", rules, fine), "URL: http://93.184.216.34/\nTitle: Hi\n\nHello");
});
