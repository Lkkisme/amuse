/**
 * Explicitly enabled bridge to a local desktop MCP server. One bridge is shared
 * by all Amuse agents, so calls cannot contend for the same mouse and keyboard.
 * No server is started until createDesktopTools is called.
 */
import { type AgentToolResult, type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { status } from "./status.ts";

export interface DesktopOptions {
  command: string;
  args?: string[] | undefined;
  cwd?: string | undefined;
  env?: Record<string, string> | undefined;
}

export interface DesktopTools {
  tools: ToolDefinition[];
  close(): Promise<void>;
}

interface ProcessTreeRuntime {
  platform: string;
  terminate(pid: number): Promise<void>;
  alive(pid: number): boolean;
}

const processTreeRuntime: ProcessTreeRuntime = {
  platform: process.platform,
  terminate: (pid) => new Promise<void>((resolve, reject) => {
    // An absolute executable avoids searching the workspace or a server's PATH.
    const taskkill = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe");
    execFile(taskkill, ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 10_000 }, (error) => error ? reject(error) : resolve());
  }),
  alive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  },
};

/**
 * Windows-MCP can spawn PowerShell in another process group. The SDK's close
 * kills only its direct child, so terminate the owned tree before SDK cleanup.
 * Read only the transport's current PID; never cache one after it has closed.
 */
export async function terminateDesktopProcessTree(transport: { readonly pid: number | null }, runtime = processTreeRuntime): Promise<void> {
  if (runtime.platform !== "win32") return;
  const pid = transport.pid;
  if (pid === null) return;
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("The desktop transport has no valid process ID.");
  try {
    // No asynchronous work between observing the owned PID and spawning taskkill.
    await runtime.terminate(pid);
  } catch (error) {
    // The process can exit naturally while taskkill starts. Its SDK close event
    // clears pid; otherwise distinguish an absent process from access denial.
    if (transport.pid !== pid) return;
    try {
      if (!runtime.alive(pid)) return;
    } catch {
      // An inability to inspect the process is not evidence that it has exited.
    }
    throw error;
  }
}

/** Keep remote errors as errors and preserve images, rather than stringifying screenshots. */
function resultOf(result: CallToolResult): AgentToolResult<{ mcp: CallToolResult }> {
  const content: AgentToolResult["content"] = result.content.map((block) => {
    if (block.type === "text" || block.type === "image") return block;
    // Pi accepts text and images. Keep other MCP blocks verbatim in details,
    // and give the model a readable representation instead of silently dropping them.
    return { type: "text", text: JSON.stringify(block) };
  });
  if (content.length === 0 && result.structuredContent !== undefined)
    content.push({ type: "text", text: JSON.stringify(result.structuredContent) });
  return { content, details: { mcp: result }, isError: result.isError === true };
}

/** Reject a queued request promptly on cancellation; it will never reach the server. */
function queued<T>(promise: Promise<T>, signal: AbortSignal | undefined, started: () => boolean): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    // Active calls must await MCP cancellation and process-tree cleanup. Only
    // requests still waiting in the queue can reject immediately.
    const abort = () => {
      if (!started()) reject(signal.reason ?? new DOMException("The desktop request was cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/**
 * Example: command = Windows venv's python.exe,
 * args = ["-m", "windows_mcp", "serve", "--transport", "stdio"].
 * The SDK launches the executable directly, without a command shell or HTTP server.
 */
export async function createDesktopTools(options: DesktopOptions): Promise<DesktopTools> {
  if (!options.command.trim()) throw new Error("A desktop MCP executable is required.");
  const client = new Client({ name: "amuse-desktop", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: options.command,
    ...(options.args ? { args: options.args } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
    // Servers may log local data or arguments to stderr. Never relay it into
    // Amuse logs, and do not leave an unread stderr pipe that could block it.
    stderr: "ignore",
  });
  let closed = false;
  let closing: Promise<void> | undefined;
  let tail = Promise.resolve();
  let known = new Set<string>();

  const close = (): Promise<void> => {
    closed = true;
    return (closing ??= (async () => {
      try {
        await terminateDesktopProcessTree(transport);
      } finally {
        await client.close();
      }
    })());
  };

  const serial = <T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    let started = false;
    const next = tail.then(async () => {
      signal?.throwIfAborted();
      if (closed) throw new Error("The desktop MCP connection is closed. Restart Amuse to reconnect.");
      started = true;
      try {
        const result = await run();
        signal?.throwIfAborted();
        return result;
      } catch (error) {
        // MCP cancellation is advisory. Stop the child before releasing the
        // queue so an ignored cancellation cannot overlap a later desktop call.
        // Protocol failures/timeouts also leave an action's state uncertain.
        try {
          await close();
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "The desktop request failed and its process tree could not be stopped.");
        }
        if (signal?.aborted) signal.throwIfAborted();
        throw error;
      }
    });
    tail = next.then(() => {}, () => {});
    return queued(next, signal, () => started);
  };

  const list = async (signal?: AbortSignal): Promise<Tool[]> => {
    const tools: Tool[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, signal ? { signal } : {});
      tools.push(...page.tools);
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error("Desktop MCP returned a repeated tools/list cursor.");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    known = new Set(tools.map((tool) => tool.name));
    return tools;
  };

  try {
    await client.connect(transport);
    // Only discovery happens at startup. No screenshot, command or UI action.
    await list();
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }

  return {
    close,
    tools: [
      defineTool({
        name: "desktop_tools",
        label: "Look up desktop actions",
        description: "List the actual tools and complete input JSON schemas exposed by the local Windows desktop MCP server. Inspect these before desktop_call; use only documented names and arguments.",
        parameters: Type.Object({ status }),
        async execute(_, _args, signal) {
          return serial(async () => {
            const tools = await list(signal);
            return { content: [{ type: "text" as const, text: JSON.stringify({ tools }, null, 2) }], details: { tools } };
          }, signal);
        },
      }),
      defineTool({
        name: "desktop_call",
        label: "Use the Windows desktop",
        description: "Call a local Windows desktop MCP tool returned by desktop_tools, using its exact input schema. Acts on the user's real desktop. Calls share one queue across agents; cancellation closes the connection to prevent overlapping actions.",
        parameters: Type.Object({
          status,
          name: Type.String({ description: "Exact MCP tool name from desktop_tools" }),
          args: Type.Record(Type.String(), Type.Unknown(), { description: "Arguments conforming to that tool's inputSchema" }),
        }),
        async execute(_, { name, args }, signal) {
          // Unknown names never go to tools/call and do not close the connection.
          if (!known.has(name)) throw new Error(`Unknown desktop tool "${name}". Call desktop_tools to refresh its schema.`);
          return serial(async () => resultOf(CallToolResultSchema.parse(await client.callTool({ name, arguments: args }, CallToolResultSchema, signal ? { signal } : {}))), signal);
        },
      }),
    ],
  };
}
