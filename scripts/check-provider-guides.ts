/**
 * Asks the web about every URL in the provider guides and prints each one's id,
 * URL and final status after redirects. Network-bound, so it is not part of
 * `mise run check`: run it with `node scripts/check-provider-guides.ts`.
 * A login redirect is fine (key pages sit behind one); a 404 or a dead host is not.
 */
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { guides } from "../pi/src/guides.ts";

const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIMEOUT_S = 25;
const run = promisify(execFile);

interface Probe {
  id: string;
  field: string;
  url: string;
}

const probes: Probe[] = Object.entries(guides).flatMap(([id, guide]) => {
  const fields: [string, string | undefined][] = [["home", guide.home], ["keys", guide.keys], ["docs", guide.docs]];
  const seen = new Set<string>();
  return fields.flatMap(([field, url]) => {
    if (url === undefined || seen.has(url)) return [];
    seen.add(url);
    return [{ id, field, url }];
  });
});

/** The final status, and where it ended up when redirected. curl keeps cookies, which some logins set before they stop redirecting. */
async function status(url: string): Promise<string> {
  const jar = mkdtempSync(join(tmpdir(), "amuse-guides-")) + "/jar";
  try {
    const { stdout } = await run(
      "curl",
      ["-sL", "-m", String(TIMEOUT_S), "-o", "/dev/null", "-A", BROWSER, "-c", jar, "-b", jar, "-w", "%{http_code} %{url_effective}", url],
    );
    const [code = "", landed = url] = stdout.split(" ");
    const from = new URL(url);
    const to = new URL(landed);
    return code === "000" ? "FAILED no answer" : `${code}${from.origin + from.pathname === to.origin + to.pathname ? "" : ` -> ${to.origin}${to.pathname}`}`;
  } catch (error) {
    return `FAILED ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
  }
}

const results = await Promise.all(probes.map(async (p) => ({ ...p, result: await status(p.url) })));
for (const r of results) console.log(`${r.id}\t${r.field}\t${r.url}\t${r.result}`);
// 202, 403 and 429 are a site's bot wall answering a script: the page is not shown to us, so it is unverified, not broken
const walled = results.filter((r) => /^(202|403|429)/.test(r.result));
const bad = results.filter((r) => !/^(200|30\d)/.test(r.result) && !walled.includes(r));
console.log(`\n${results.length} urls, ${walled.length} behind a bot wall, ${bad.length} broken`);
for (const r of walled) console.log(`  wall\t${r.id}\t${r.field}\t${r.url}\t${r.result}`);
for (const r of bad) console.log(`  broken\t${r.id}\t${r.field}\t${r.url}\t${r.result}`);
if (bad.length) process.exitCode = 1;
