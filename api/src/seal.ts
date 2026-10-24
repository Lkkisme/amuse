/**
 * How the Vault keeps a secret field's value: sealed with AES-256-GCM (node:crypto, nothing else), a fresh
 * random nonce each time, and bound to the entry and field it belongs to, so a sealed value moved to another entry
 * or field does not open. A sealed value is text: base64 of
 *   version (1 byte) | nonce (12) | tag (16) | ciphertext
 * and the version says how the rest is read, so the algorithm can change later with the old values still readable.
 *
 * The key is 32 random bytes in a file of its own, apart from the data (the compose `/secrets` volume): made on the
 * first start, and never made anew over data that was sealed with another one. A copy or leak of the data alone
 * gives no value; a compromised server does, which is no protection to claim.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { createFile } from "./durable.ts";

const VERSION = 1;
const NONCE = 12;
const TAG = 16;
const KEY = 32;

/** The key is gone, or damaged, and there are sealed values that need it: said in words, and nothing is made anew. */
export class KeyUnavailable extends Error {
  /** what is wrong with it: it is not there, it is not a key, or it is not the one the secrets were sealed with */
  readonly trouble: "missing" | "damaged" | "wrong";
  constructor(message: string, trouble: "missing" | "damaged" | "wrong") {
    super(message);
    this.trouble = trouble;
  }
}

/** A sealed value that does not open: another key, another entry or field, or damaged. */
export class Unsealable extends Error {}

export interface Seal {
  /** `value`, sealed to the field `field` of the entry `entry`. */
  seal(value: Uint8Array, entry: string, field: string): string;
  /** What `sealed` holds, if it is the one sealed to this entry and field with this key. */
  open(sealed: string, entry: string, field: string): Uint8Array;
}

/** What binds a sealed value to where it belongs, and to the format it is in. */
const bound = (version: number, entry: string, field: string) => Buffer.from(JSON.stringify([version, entry, field]), "utf8");

export function sealer(key: Uint8Array): Seal {
  if (key.length !== KEY) throw new KeyUnavailable("The Vault's key is not 32 bytes.", "damaged");
  return {
    seal(value, entry, field) {
      const nonce = randomBytes(NONCE);
      const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG });
      cipher.setAAD(bound(VERSION, entry, field));
      const body = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([Buffer.of(VERSION), nonce, cipher.getAuthTag(), body]).toString("base64");
    },
    open(sealed, entry, field) {
      const bytes = Buffer.from(sealed, "base64");
      const version = bytes[0];
      if (version !== VERSION) throw new Unsealable("A secret is sealed in a format this version does not know.");
      if (bytes.length < 1 + NONCE + TAG) throw new Unsealable("A sealed secret is cut short.");
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(1, 1 + NONCE), { authTagLength: TAG });
      decipher.setAAD(bound(version, entry, field));
      decipher.setAuthTag(bytes.subarray(1 + NONCE, 1 + NONCE + TAG));
      try {
        return new Uint8Array(Buffer.concat([decipher.update(bytes.subarray(1 + NONCE + TAG)), decipher.final()]));
      } catch {
        throw new Unsealable("A secret could not be opened: it is not sealed to this entry and field with this key.");
      }
    },
  };
}

const refused = (path: string) =>
  `The Vault's key file (${path}) is not a key (it should be ${KEY} bytes). Restore it from your backup; a new one is not made over secrets sealed with the old.`;

/**
 * The key in `path`, made (owner-only, and whole or not at all) when there is none and nothing sealed needs one.
 * `sealedData`: whether there are sealed values already. A missing key with sealed values is refused, in words; so is
 * one of the wrong size.
 */
export function fileKey(path: string, sealedData: boolean): Buffer {
  const read = (): Buffer => {
    let key: Buffer;
    try {
      key = readFileSync(path);
    } catch {
      // a folder where the file should be, or a file that is not Amuse's to read
      throw new KeyUnavailable(`The Vault's key file (${path}) could not be read: it may be a folder, or not Amuse's to read. Restore it from your backup; a new one is not made over secrets sealed with the old.`, "damaged");
    }
    if (key.length !== KEY) throw new KeyUnavailable(refused(path), "damaged");
    return key;
  };
  if (existsSync(path)) return read();
  if (sealedData)
    throw new KeyUnavailable(
      `The Vault's key file (${path}) is missing, and the store holds secrets sealed with it. Restore the file from your backup. A new key is not made, so that nothing is lost by mistake. Without the old key the sealed secrets cannot be opened: if the key is lost for good, \`amuse-admin reset-vault --yes\` forgets everything in the Vault so that a new key can be made.`,
      "missing",
    );
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const key = randomBytes(KEY);
  // a key that appeared meanwhile is the one to use, never replaced
  return createFile(path, key, 0o600) ? key : read();
}
