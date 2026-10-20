/**
 * JSON Schema → Kotlin (kotlinx.serialization), for the shapes the protocol
 * allows and nothing else:
 *   tagged union (oneOf, every variant has one const tag) → sealed interface
 *   object → data class (data object when empty)
 *   enum → enum class;  T | null → T?;  array → List;  string/integer/boolean
 * Anything else is an error, so a protocol change that Kotlin cannot express
 * fails the build instead of producing loose types.
 *
 * Usage: node scripts/kotlin.ts <package>   (reads .generated/protocol.schema.json)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

type Schema = {
  $ref?: string;
  type?: string | string[];
  const?: string;
  enum?: string[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  oneOf?: Schema[];
  anyOf?: Schema[];
};

const pkg = process.argv[2] ?? "remuse.protocol";
const dir = new URL("../.generated/", import.meta.url);
const defs: Record<string, Schema> = JSON.parse(readFileSync(new URL("protocol.schema.json", dir), "utf8")).$defs;

/** JSON-RPC framing is hand-written per platform; the contract is everything else. */
const framing = new Set(["Request", "Response", "RpcError", "RpcId", "Notification"]);

const pascal = (s: string) => s.replace(/(^|[^a-zA-Z0-9])([a-zA-Z0-9])/g, (_, __, c: string) => c.toUpperCase());
const refName = (ref: string) => ref.replace("#/$defs/", "");
const deref = (s: Schema): Schema => (s.$ref ? (defs[refName(s.$ref)] ?? fail(`unknown ref ${s.$ref}`)) : s);
function fail(message: string): never {
  throw new Error(`kotlin: ${message}`);
}

const out: string[] = [];
/** sealed parents per class name: a $ref variant implements its union */
type Parent = { union: string; tag: string; key: string };
const parents = new Map<string, Parent[]>();

/** The tag property and value of a union variant, if it has exactly one const. */
function tagOf(variant: Schema): [string, string] {
  const consts = Object.entries(deref(variant).properties ?? {}).flatMap(([key, v]): [string, string][] => (v.const === undefined ? [] : [[key, v.const]]));
  return consts.length === 1 && consts[0] ? consts[0] : fail(`union variant needs exactly one const tag: ${JSON.stringify(variant).slice(0, 120)}`);
}

function isUnion(s: Schema): s is Schema & { oneOf: Schema[] } {
  return Array.isArray(s.oneOf);
}

/** Kotlin type for a property schema; inline enums/objects/unions become named declarations. */
function typeOf(s: Schema, owner: string): string {
  if (s.$ref) {
    deref(s); // fail early on a dangling ref
    return refName(s.$ref);
  }
  if (s.anyOf) {
    const rest = s.anyOf.filter((v) => v.type !== "null");
    const only = rest[0];
    return rest.length === 1 && only && rest.length < s.anyOf.length ? `${typeOf(only, owner)}?` : fail(`unsupported anyOf in ${owner}`);
  }
  if (Array.isArray(s.type)) {
    const [only, ...rest] = s.type.filter((t) => t !== "null");
    return only && rest.length === 0 && s.type.includes("null") ? `${primitive({ type: only })}?` : fail(`unsupported type list in ${owner}`);
  }
  if (s.type === "array" && s.items) return `List<${typeOf(s.items, `${owner}Item`)}>`;
  if (s.enum || s.properties || isUnion(s)) return declare(owner, s);
  return primitive(s);
}

function primitive(s: Schema): string {
  switch (s.type) {
    case "string":
      return "String";
    case "integer":
      return "Long";
    case "boolean":
      return "Boolean";
    default:
      return fail(`unsupported type ${JSON.stringify(s).slice(0, 80)}`);
  }
}

const quote = (name: string) => (/^[a-z][a-zA-Z0-9]*$/.test(name) && !keywords.has(name) ? name : `\`${name}\``);
const keywords = new Set(["as", "break", "class", "continue", "do", "else", "false", "for", "fun", "if", "in", "interface", "is", "null", "object", "package", "return", "super", "this", "throw", "true", "try", "typealias", "val", "var", "when", "while"]);

/** Emit a declaration for `s` named `name`; returns the name. */
function declare(name: string, s: Schema, inline?: Parent): string {
  if (isUnion(s)) {
    const key = tagOf(s.oneOf[0] ?? fail(`empty union ${name}`))[0];
    out.push(`@OptIn(ExperimentalSerializationApi::class)\n@Serializable\n@JsonClassDiscriminator("${key}")\nsealed interface ${name}\n`);
    for (const variant of s.oneOf) {
      const [k, tag] = tagOf(variant);
      if (k !== key) fail(`${name}: variants disagree on the tag (${key} vs ${k})`);
      if (variant.$ref) {
        const target = refName(variant.$ref);
        parents.set(target, [...(parents.get(target) ?? []), { union: name, tag, key }]);
      } else {
        declare(`${name}${pascal(tag)}`, variant, { union: name, tag, key });
      }
    }
    return name;
  }
  if (s.enum) {
    const entries = s.enum.map((v) => `  @SerialName("${v}") ${pascal(v)},`).join("\n");
    out.push(`@Serializable\nenum class ${name} {\n${entries}\n}\n`);
    return name;
  }
  if (s.properties) {
    const tags = inline ? [inline] : (parents.get(name) ?? []);
    if (new Set(tags.map((t) => t.tag)).size > 1) fail(`${name} has different tags in different unions`);
    const tagKeys = new Set(tags.map((t) => t.key));
    const fields = Object.entries(s.properties)
      .filter(([k]) => !tagKeys.has(k))
      .map(([k, v]) => `  val ${quote(k)}: ${typeOf(v, `${name}${pascal(k)}`)},`);
    const serial = tags[0] ? `@SerialName("${tags[0].tag}")\n` : "";
    const supers = tags.length ? ` : ${tags.map((t) => t.union).join(", ")}` : "";
    out.push(
      fields.length
        ? `@Serializable\n${serial}data class ${name}(\n${fields.join("\n")}\n)${supers}\n`
        : `@Serializable\n${serial}data object ${name}${supers}\n`,
    );
    return name;
  }
  return fail(`cannot declare ${name}`);
}

const names = Object.keys(defs).filter((n) => !framing.has(n));
// unions first, so every $ref variant knows its sealed parents before it is emitted
const ordered = [...names.filter((n) => isUnion(defs[n] ?? {})), ...names.filter((n) => !isUnion(defs[n] ?? {}))];
const aliases: string[] = [];
for (const name of ordered) {
  const s = defs[name] ?? fail(name);
  if (s.type && !s.properties && !s.enum) aliases.push(`typealias ${name} = ${primitive(s)}\n`);
  else declare(name, s);
}

const file = `// Generated by protocol/scripts/kotlin.ts from protocol.schema.json. Do not edit.
@file:Suppress("unused")

package ${pkg}

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator

${[...aliases, ...out].join("\n")}`;

mkdirSync(new URL("kotlin/", dir), { recursive: true });
writeFileSync(new URL("kotlin/Protocol.kt", dir), file);
console.log(`kotlin: ${out.length + aliases.length} declarations → .generated/kotlin/Protocol.kt`);
