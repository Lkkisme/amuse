/** Owner-local CLI for the chat-scoped browser MCP, including existing Codex sessions. */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { BrowserMcpStepSchema } from "./browser-mcp.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const help = "用法：AMUSE-BROWSER.cmd --chat <聊天ID> open <URL>|list|observe <浏览器ID>|act <浏览器ID> <JSON>|screenshot <浏览器ID>|finish <浏览器ID> <结果>；AMUSE-TOOLS.cmd --chat <聊天ID> tools 或 call <工具名称> --json-file <参数JSON绝对路径>。";
// Windows PowerShell 5 writes UTF-8 JSON with a BOM by default.
const inputJson = (value: string): unknown => JSON.parse(value.replace(/^\uFEFF/, ""));
export interface BrowserCliCall { chat: string; name: string; arguments: Record<string, unknown> }

export function parseBrowserCli(argv: string[], read = (path: string) => readFileSync(path, "utf8")): BrowserCliCall {
  let chat: string | undefined;
  let jsonFile: string | undefined;
  const args: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]!;
    if (value === "--chat" || value === "--json-file") {
      const next = argv[++index];
      if (!next || next.startsWith("--")) throw new Error(help);
      if (value === "--chat") { if (chat !== undefined) throw new Error("--chat 只能指定一次。"); chat = next; }
      else { if (jsonFile !== undefined) throw new Error("--json-file 只能指定一次。"); jsonFile = next; }
    } else args.push(value);
  }
  if (!chat?.trim()) throw new Error(help);
  const [command, id, ...extra] = args;
  if (jsonFile && (!["act", "call"].includes(command ?? "") || extra.length > 0 || !isAbsolute(jsonFile))) throw new Error("--json-file 仅用于 act/call，必须是绝对路径，且不能同时提供内联 JSON。");
  if (command === "tools" && !id) return { chat, name: "$tools", arguments: {} };
  if (command === "call" && id && /^[A-Za-z_][A-Za-z0-9_-]{0,95}$/.test(id) && (jsonFile || extra.length === 1)) {
    let value: unknown;
    try { value = inputJson(jsonFile ? read(jsonFile) : extra[0]!); } catch { throw new Error("工具参数必须是 JSON 对象。"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("工具参数必须是 JSON 对象。");
    return { chat, name: id, arguments: value as Record<string, unknown> };
  }
  if (command === "open" && id && extra.length === 0) {
    let url: URL;
    try { url = new URL(id); } catch { throw new Error("请使用完整的 HTTP 或 HTTPS 地址。"); }
    if (!/^https?:$/.test(url.protocol)) throw new Error("请使用 HTTP 或 HTTPS 地址。");
    return { chat, name: "browser_open", arguments: { url: url.href } };
  }
  if (command === "list" && !id) return { chat, name: "browser_list", arguments: {} };
  if ((command === "observe" || command === "screenshot") && id && extra.length === 0)
    return { chat, name: `browser_${command}`, arguments: { id } };
  if (command === "act" && id && (jsonFile || extra.length === 1)) {
    let step: unknown;
    try { step = inputJson(jsonFile ? read(jsonFile) : extra[0]!); }
    catch { throw new Error("浏览器动作必须是有效的 JSON；复杂内容请使用 --json-file 绝对路径。"); }
    const checked = BrowserMcpStepSchema.safeParse(step);
    if (!checked.success) throw new Error(`浏览器动作无效：${checked.error.issues[0]?.message ?? "请检查 kind 和参数。"}`);
    return { chat, name: "browser_act", arguments: { id, step: checked.data } };
  }
  if (command === "finish" && id && extra.length > 0) return { chat, name: "browser_finish", arguments: { id, result: extra.join(" ") } };
  throw new Error(help);
}

/** Never include token-file contents or parser details in an operator-facing error. */
export function browserCliToken(path: string, chat: string): string {
  let stored: unknown;
  try { stored = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("浏览器凭据不可用；请先在 Amuse 的对应聊天发送一条消息以初始化浏览器工具。"); }
  if (!stored || typeof stored !== "object" || !("version" in stored) || stored.version !== 1 || !("tokens" in stored) || !stored.tokens || typeof stored.tokens !== "object")
    throw new Error("浏览器凭据文件格式无效；请从 Amuse 聊天初始化，不会自动生成凭据。");
  const token = Object.hasOwn(stored.tokens, chat) ? (stored.tokens as Record<string, unknown>)[chat] : undefined;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("这个聊天尚未初始化浏览器工具；请先在 Amuse 对应聊天发送消息，不会自动生成凭据。");
  return token;
}

export function withoutBrowserCredential(text: string, token: string): string {
  return text.split(token).join("[credential redacted]").replace(/Bearer\s+[A-Za-z0-9_-]{43}/gi, "Bearer [credential redacted]");
}

export async function runBrowserCli(argv: string[], options: { root?: string; endpoint?: string; write?: (text: string) => void } = {}): Promise<number> {
  const localRoot = options.root ?? root;
  const write = options.write ?? ((text: string) => process.stdout.write(`${text}\n`));
  const call = parseBrowserCli(argv);
  const token = browserCliToken(join(localRoot, ".local", "browser-mcp.json"), call.chat);
  const client = new Client({ name: "amuse-browser-cli", version: "1.0.0" });
  try {
    const transport = new StreamableHTTPClientTransport(new URL(options.endpoint ?? "http://127.0.0.1:8081/mcp/browser"), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    // The SDK's getter is string|undefined while Transport declares an optional
    // string; they interoperate at runtime under exactOptionalPropertyTypes.
    await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
    if (call.name === "$tools") { write(withoutBrowserCredential(JSON.stringify(await client.listTools()), token)); return 0; }
    const result = await client.callTool({ name: call.name, arguments: call.arguments }, undefined, { timeout: 120_000 });
    const content = Array.isArray(result.content) ? result.content : [];
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") write(withoutBrowserCredential(block.text, token));
      if (block.type === "image") {
        if (block.mimeType !== "image/png" || typeof block.data !== "string") throw new Error("浏览器截图没有返回预期的 PNG 图像。");
        const bytes = Buffer.from(block.data, "base64");
        if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("浏览器截图不是有效的 PNG 图像。");
        const directory = join(localRoot, ".local", "browser", "observations");
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const name = createHash("sha256").update(`${call.chat}:${String(call.arguments["id"] ?? "")}:${randomUUID()}`).digest("hex");
        const path = join(directory, `${name}.png`);
        writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
        write(JSON.stringify({ path, mimeType: "image/png", bytes: bytes.length }));
      }
    }
    if (result.structuredContent !== undefined) write(withoutBrowserCredential(JSON.stringify(result.structuredContent), token));
    return result.isError ? 1 : 0;
  } catch (error) {
    throw new Error(withoutBrowserCredential(error instanceof Error ? error.message : "浏览器请求失败。", token));
  } finally { await client.close().catch(() => {}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBrowserCli(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "浏览器命令执行失败。"}\n`);
    process.exitCode = 1;
  });
}
