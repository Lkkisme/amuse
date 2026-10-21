/**
 * Files the user sent, as the agent gets them: the images of the message it
 * is answering, seen directly; any file, read on demand (read_attachment):
 * an image to look at, text as text, a PDF's text; anything else only by name.
 * What a file says is the user's, but it may hold anything: it reaches the
 * agent as untrusted data.
 */
import { type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import { type Files, size } from "@remuse/core";
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
export async function images(files: Files, attachments: Attachment[]): Promise<ImageContent[]> {
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
export async function textOf(attachment: Attachment, data: Uint8Array): Promise<string | null> {
  if (attachment.type === "application/pdf" || /\.pdf$/i.test(attachment.name)) {
    const pdf = await getDocumentProxy(data);
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  return textual(attachment.type, attachment.name) ? new TextDecoder().decode(data) : null;
}

type Result = { content: ({ type: "text"; text: string } | ImageContent)[]; details: null };
const say = (text: string): Result => ({ content: [{ type: "text", text }], details: null });

export function attachmentTools(files: Files): ToolDefinition[] {
  return [
    defineTool({
      name: "read_attachment",
      label: "Look at a file",
      description:
        "Look at a file the user sent, by its id (f-…, shown where it was attached): an image to see, a text file or a PDF to read. Images in the message you are answering are already shown to you.",
      parameters: Type.Object({ status, id: Type.String() }),
      async execute(_, { id }): Promise<Result> {
        const file = await files.read(id);
        if (!file) return say(`There is no file ${id}.`);
        const { attachment, data } = file;
        if (seeable(attachment.type)) {
          if (attachment.size > IMAGE_LIMIT) return say(`${attachment.name} is too large an image to look at (${size(attachment.size)}).`);
          return { content: [{ type: "text", text: attachment.name }, { type: "image", data: Buffer.from(data).toString("base64"), mimeType: attachment.type }], details: null };
        }
        const text = await textOf(attachment, data).catch(() => null);
        if (text === null) return say(`${attachment.name} is a ${attachment.type} file (${size(attachment.size)}); what is in it cannot be read here.`);
        const clipped = text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n… (cut; ${text.length - TEXT_LIMIT} more characters)` : text;
        return say(`${attachment.name}:\n${untrusted(clipped)}`);
      },
    }),
  ];
}
