/**
 * The workspace as the agent reads it: what a file says comes back with the secrets that are in the sandbox masked, as
 * what the sandbox prints does (`env > ~/workspace/x`, then reading x, would otherwise carry them to the agent). The
 * user's own view of their files (downloads, the web app) is the workspace itself, not this. Only text is masked: what
 * is not text (a picture) is as it is.
 */
import { type Workspace } from "@amuse/core";
import { type Masked, mask } from "@amuse/sandbox";

const text = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

/** `data` with the secrets in it masked, if it is text and holds any. */
function masked(data: Uint8Array, secrets: readonly Masked[]): Uint8Array {
  if (secrets.length === 0) return data;
  let content: string;
  try {
    content = text.decode(data);
  } catch {
    return data;
  }
  const clean = mask(content, secrets);
  return clean === content ? data : encoder.encode(clean);
}

export function maskingFiles(files: Workspace, secrets: () => readonly Masked[]): Workspace {
  return {
    ...files,
    open: async (path) => {
      const file = await files.open(path);
      const data = masked(file.data, secrets());
      return data === file.data ? file : { ...file, data, size: data.length };
    },
    read: async (id) => {
      const file = await files.read(id);
      if (!file) return file;
      const data = masked(file.data, secrets());
      return data === file.data ? file : { ...file, data };
    },
  };
}
