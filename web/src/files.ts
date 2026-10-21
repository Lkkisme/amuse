/**
 * The user's files, where there is a server to keep them: uploading one
 * (POST /files, before it is sent with a message) and where each one is
 * (GET /files/<id>, for the page to show). The demo has none.
 */
import { createContext, useContext } from "react";
import { Attachment } from "@remuse/protocol";

export interface FileAccess {
  upload(file: File): Promise<Attachment>;
  url(id: string): string;
}

/** Next to /rpc on the same server (keeping its token, in the cross-origin dev setup), over http(s). */
function beside(rpc: string, path: string): string {
  const url = new URL(rpc);
  url.pathname = path;
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url.toString();
}

export function serverFiles(rpc: string): FileAccess {
  return {
    async upload(file) {
      const response = await fetch(beside(rpc, "/files"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
        body: file,
      });
      if (response.status === 413) throw new Error(`${file.name} is too large (50 MB at most).`);
      if (!response.ok) throw new Error(`${file.name} could not be uploaded (${response.status}).`);
      return Attachment.parse(await response.json());
    },
    url: (id) => beside(rpc, `/files/${encodeURIComponent(id)}`),
  };
}

export const Files = createContext<FileAccess | null>(null);
export const useFiles = () => useContext(Files);
