/**
 * Emit language-neutral artifacts from the protocol schemas:
 *   .generated/protocol.schema.json  JSON Schema (draft 2020-12) of every type,
 *                                    the input for typed Kotlin/Swift codegen
 *   .generated/openrpc.json          OpenRPC document of the methods and the event notification
 *   .generated/fixtures.json         typed samples for cross-language round-trip checks
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import * as protocol from "../src/index.ts";
import { Call, Push, apply, empty, results } from "../src/index.ts";
import { calls, envelopes } from "../src/fixtures.ts";

const out = new URL("../.generated/", import.meta.url);
mkdirSync(out, { recursive: true });

const schema = (type: z.ZodType) => z.toJSONSchema(type, { target: "draft-2020-12" });

/** Every exported schema under its export name, so generated types get real names and $refs. */
const named = z.registry<{ id: string }>();
for (const [name, value] of Object.entries(protocol)) {
  if (value instanceof z.ZodType) named.add(value, { id: name });
}
/** Method results get names too (`chat.send` → ChatSendResult); bare `null` results need none. */
for (const [method, result] of Object.entries(results)) {
  if (!(result instanceof z.ZodNull)) named.add(result, { id: `${method.replace(/(^|\.)(\w)/g, (_, __, c: string) => c.toUpperCase())}Result` });
}
const document = z.toJSONSchema(named, { target: "draft-2020-12", uri: (id) => `#/$defs/${id}` });
const types = document.schemas;

const methods = Call.options.map((option) => {
  const name = option.shape.method.value;
  return {
    name,
    paramStructure: "by-name",
    params: Object.entries(option.shape.params.shape).map(([param, type]) => ({
      name: param,
      required: true,
      schema: schema(type),
    })),
    result: { name: "result", schema: schema(results[name]) },
  };
});

const openrpc = {
  openrpc: "1.3.2",
  info: { title: "remuse", version: "0.1.0" },
  methods,
  "x-notifications": [{ name: "push", params: schema(Push) }],
};

const write = (file: string, value: unknown) => writeFileSync(new URL(file, out), `${JSON.stringify(value, null, 2)}\n`);
write("protocol.schema.json", {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $defs: Object.fromEntries(Object.entries(types).map(([id, { $schema, $id, ...rest }]) => [id, rest])),
});
write("openrpc.json", openrpc);
write("fixtures.json", { envelopes, calls, state: envelopes.reduce(apply, empty) });
console.log(`protocol: ${Object.keys(types).length} types, ${methods.length} methods → .generated/`);
