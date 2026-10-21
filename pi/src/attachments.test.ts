import assert from "node:assert/strict";
import { test } from "node:test";
import { type Workspace, noWorkspace } from "@remuse/core";
import { images, textOf } from "./attachments.ts";

/** A one-page PDF that says "Hello PDF". */
function pdf(): Uint8Array {
  const stream = "BT /F1 24 Tf 72 720 Td (Hello PDF) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

test("a file's text: text files as they are, a PDF's text, nothing for other kinds", async () => {
  const text = new TextEncoder().encode("line one\nline two");
  assert.equal(await textOf({ name: "notes.txt", type: "text/plain" }, text), "line one\nline two");
  assert.match((await textOf({ name: "a.pdf", type: "application/pdf" }, pdf())) ?? "", /Hello PDF/);
  assert.equal(await textOf({ name: "a.zip", type: "application/zip" }, new Uint8Array([1, 2, 3])), null);
});

test("the images of a message go to the model; other files do not", async () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const files: Workspace = {
    ...noWorkspace,
    read: async (id: string) => (id === "f-img" ? { attachment: { id, name: "a.png", type: "image/png", size: 4, path: "user/media_library/a.png" }, data: png } : null),
  };
  const shown = await images(files, [
    { id: "f-img", name: "a.png", type: "image/png", size: 4, path: "user/media_library/a.png" },
    { id: "f-doc", name: "a.pdf", type: "application/pdf", size: 9, path: "user/a.pdf" },
    { id: "f-gone", name: "b.png", type: "image/png", size: 4, path: "user/media_library/b.png" },
  ]);
  assert.deepEqual(shown, [{ type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" }]);
});
