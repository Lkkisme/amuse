/**
 * Muse's workspace, as the agent uses it: files the user sent (user/, with
 * pictures and videos in user/media_library/), the browser's downloads
 * (downloads/), and its own. It lists, reads (an image to see, text as text,
 * a PDF's text), writes, moves and deletes them, and sends one to the user
 * in the chat. The images of the message it answers it sees directly.
 * Deleting or overwriting what the user sent (wherever it has been moved)
 * is theirs to approve; the rest is Muse's to keep in order. What a file says reaches the agent as
 * untrusted data.
 */
import { type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import { type AgentIO, type Workspace, describe, newId, size } from "@remuse/core";
import type { Attachment } from "@remuse/protocol";
import { Type } from "typebox";
import { extractText, getDocumentProxy } from "unpdf";
import { status } from "./status.ts";
import { untrusted } from "./untrusted.ts";

/** Image kinds a model takes. */
const seeable = (type: string) => /^image\/(png|jpeg|gif|webp)$/.test(type);
/** Kinds read as text. */
const textual = (type: string, name: string) =>
  type.startsWith("text/") || /json|xml|yaml|csv|javascript|typescript|markdown|x-sh/.test(type) || /\.(txt|md|csv|json|ya?ml|xml|log|ts|js|py|sh|html?)$/i.test(name);
/** Characters of a file's text given at once. */
const TEXT_LIMIT = 30_000;
/** Bytes of an image given to the model. */
const IMAGE_LIMIT = 15 * 1024 ** 2;

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

/** The images among `attachments`, ready for the model (ones too large or gone are left out). */
export async function images(files: Workspace, attachments: Attachment[]): Promise<ImageContent[]> {
  const shown = await Promise.all(
    attachments
      .filter((a) => seeable(a.type) && a.size <= IMAGE_LIMIT)
      .map(async (a): Promise<ImageContent | null> => {
        const file = await files.read(a.id);
        return file ? { type: "image", data: Buffer.from(file.data).toString("base64"), mimeType: a.type } : null;
      }),
  );
  return shown.filter((image) => image !== null);
}

/** A file's text, as far as it can be read: UTF-8 text, or a PDF's text; null for anything else. */
export async function textOf(file: { type: string; name: string }, data: Uint8Array): Promise<string | null> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    const pdf = await getDocumentProxy(data);
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  return textual(file.type, file.name) ? new TextDecoder().decode(data) : null;
}

type Result = { content: ({ type: "text"; text: string } | ImageContent)[]; details: null };
const say = (text: string): Result => ({ content: [{ type: "text", text }], details: null });
const failed = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Do `work` on the user's files once they approve `action` (an approval card):
 * the agent is told now that it was asked, and gets a report when it is done.
 */
function onApproval(io: AgentIO, action: string, target: string, work: () => Promise<string>): string {
  const asked = io.act({ kind: "ask", action, target, detail: target, remember: false });
  if (!asked.ok) return `Could not ask: ${describe(asked.rejection)}.`;
  void io.decision(asked.id).then(async ({ verdict }) => {
    if (verdict !== "approved") return io.report(`[file not changed] ${target}: the user ${verdict === "denied" ? "declined" : "did not answer in time"}.`);
    io.report(`[file changed] ${await work().catch(failed)}`);
  });
  return `NOT done yet: ${target} holds what the user sent, so it waits for their OK on the approval card shown in the chat. Tell them it waits for their OK; do not say it is done. You get a report once it is.`;
}

/** The workspace tools; `send` only where there is a chat to send to. */
export function workspaceTools(io: () => AgentIO, files: Workspace, { send = true }: { send?: boolean } = {}): ToolDefinition[] {
  const tools = [
    defineTool({
      name: "list_files",
      label: "Look through your files",
      description:
        "List a folder of your workspace (\"\" for the top): user/ has what the user sent (pictures and videos in user/media_library/), downloads/ what the browser downloaded; the rest is yours to organize.",
      parameters: Type.Object({ status, folder: Type.Optional(Type.String()) }),
      async execute(_, { folder }) {
        try {
          const entries = await files.list(folder ?? "");
          if (entries.length === 0) return say(`${folder || "The workspace"} is empty.`);
          return say(entries.map((e) => (e.kind === "folder" ? `${e.path}/` : `${e.path} (${size(e.size)}, ${e.modified.slice(0, 16).replace("T", " ")})`)).join("\n"));
        } catch (e) {
          return say(failed(e));
        }
      },
    }),
    defineTool({
      name: "read_file",
      label: "Look at a file",
      description: "Look at a workspace file by its path: an image to see, a text file or a PDF to read. The images of the message you are answering are already shown to you.",
      parameters: Type.Object({ status, path: Type.String() }),
      async execute(_, { path }): Promise<Result> {
        try {
          const file = await files.open(path);
          if (seeable(file.type)) {
            if (file.size > IMAGE_LIMIT) return say(`${file.path} is too large an image to look at (${size(file.size)}).`);
            return { content: [{ type: "text", text: file.path }, { type: "image", data: Buffer.from(file.data).toString("base64"), mimeType: file.type }], details: null };
          }
          const text = await textOf({ type: file.type, name: file.path }, file.data).catch(() => null);
          if (text === null) return say(`${file.path} is a ${file.type} file (${size(file.size)}); what is in it cannot be read here.`);
          const clipped = text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n… (cut; ${text.length - TEXT_LIMIT} more characters)` : text;
          return say(`${file.path}:\n${untrusted(clipped)}`);
        } catch (e) {
          return say(failed(e));
        }
      },
    }),
    defineTool({
      name: "write_file",
      label: "Write a file",
      description:
        "Write a text file in your workspace (folders are made as needed). An existing file is replaced only with `overwrite`; replacing one the user sent shows them an approval card and is done once they confirm there.",
      parameters: Type.Object({ status, path: Type.String(), content: Type.String(), overwrite: Type.Optional(Type.Boolean()) }),
      async execute(_, { path, content, overwrite }) {
        const data = new TextEncoder().encode(content);
        try {
          if (overwrite && (await files.sentByUser(path)).length > 0)
            return say(onApproval(io(), "Replace a file you sent", path, async () => (await files.write(path, data, true), `${path} replaced.`)));
          await files.write(path, data, overwrite === true);
          return say(`Wrote ${path} (${size(data.length)}).`);
        } catch (e) {
          return say(failed(e));
        }
      },
    }),
    defineTool({
      name: "move_file",
      label: "Move a file",
      description: "Move or rename a file or folder in your workspace. Files sent in the chat stay linked wherever they go.",
      parameters: Type.Object({ status, from: Type.String(), to: Type.String() }),
      async execute(_, { from, to }) {
        try {
          await files.move(from, to);
          return say(`Moved ${from} to ${to}.`);
        } catch (e) {
          return say(failed(e));
        }
      },
    }),
    defineTool({
      name: "delete_file",
      label: "Delete a file",
      description:
        "Delete a file or folder in your workspace for good. For what the user sent, this shows them an approval card and deletes once they confirm there: call it as soon as they ask (the card is the confirmation; do not ask in the chat). In the chat it then shows as deleted.",
      parameters: Type.Object({ status, path: Type.String() }),
      async execute(_, { path }) {
        try {
          if (!(await files.exists(path))) return say(`There is no ${path}.`);
          // what the user sent is theirs to let go of, wherever it has been moved
          const sent = await files.sentByUser(path);
          if (sent.length > 0)
            return say(onApproval(io(), sent.length === 1 && sent[0] === path ? "Delete a file you sent" : `Delete ${path}, with ${sent.length} file(s) you sent`, path, async () => (await files.remove(path), `${path} deleted.`)));
          await files.remove(path);
          return say(`Deleted ${path}.`);
        } catch (e) {
          return say(failed(e));
        }
      },
    }),
  ];
  if (!send) return tools;
  return [
    ...tools,
    defineTool({
      name: "send_file",
      label: "Send a file",
      description: "Send a workspace file to the user in the chat (a picture or video shows there; anything else can be opened or downloaded), with an optional line about it.",
      parameters: Type.Object({ status, path: Type.String(), message: Type.Optional(Type.String()) }),
      async execute(_, { path, message }) {
        try {
          const attachment = await files.share(path);
          io().emit({ kind: "upserted", entity: { kind: "reply", id: newId("r"), at: new Date().toISOString(), text: message ?? "", streaming: false, attachments: [attachment] } });
          return say(`Sent ${attachment.name} to the user.`);
        } catch (e) {
          return say(failed(e));
        }
      },
    }),
  ];
}
