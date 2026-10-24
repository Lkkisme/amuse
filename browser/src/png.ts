/**
 * Just enough PNG to cut a picture of a page down to one element's box: what a browser's
 * screenshot is — eight bits a channel, RGB or RGBA, not interlaced — is what this reads,
 * and a picture in any other shape is left alone (null) rather than guessed at. Nothing
 * here draws: a crop is the picture's own pixels, moved.
 */
import { crc32, deflateSync, inflateSync } from "node:zlib";

/** A box on the page, in the picture's pixels: where an element is, as the page reports it. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface Picture {
  width: number;
  height: number;
  /** three (RGB) or four (RGBA) */
  channels: number;
  /** the rows' pixels, without their filter bytes */
  pixels: Uint8Array;
}

/** A PNG's size, or null when it is not one this can read. */
export function pngSize(png: Uint8Array): { width: number; height: number } | null {
  const head = header(png);
  return head && { width: head.width, height: head.height };
}

/** `png` cut down to `box` (what is in the picture of it), as a PNG; null when none of the box is in it. */
export function cropPng(png: Uint8Array, box: Box): Uint8Array | null {
  const picture = read(png);
  if (!picture) return null;
  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  const width = Math.min(Math.round(box.width), picture.width - x);
  const height = Math.min(Math.round(box.height), picture.height - y);
  if (width <= 0 || height <= 0) return null;
  const { channels } = picture;
  const kept = new Uint8Array(width * height * channels);
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * picture.width + x) * channels;
    kept.set(picture.pixels.subarray(from, from + width * channels), row * width * channels);
  }
  return write(width, height, channels, kept);
}

/** What the IHDR says, for the shape of picture this can read. */
function header(png: Uint8Array): { width: number; height: number; channels: number } | null {
  if (png.length < 33 || signature.some((byte, at) => png[at] !== byte)) return null;
  if (type(png, 12) !== "IHDR") return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const depth = png[24] ?? 0;
  const color = png[25] ?? 0;
  const interlace = png[28] ?? 0;
  if (width === 0 || height === 0 || depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) return null;
  return { width, height, channels: color === 6 ? 4 : 3 };
}

/** A chunk's type, as its four ASCII letters. */
const type = (png: Uint8Array, at: number) => String.fromCharCode(png[at] ?? 0, png[at + 1] ?? 0, png[at + 2] ?? 0, png[at + 3] ?? 0);

/** The picture the PNG holds, or null when this cannot read it. */
function read(png: Uint8Array): Picture | null {
  const head = header(png);
  if (!head) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const parts: Uint8Array[] = [];
  for (let at = 8; at + 12 <= png.length; ) {
    const length = view.getUint32(at);
    if (length > png.length - at - 12) return null;
    const kind = type(png, at + 4);
    if (kind === "IDAT") parts.push(png.subarray(at + 8, at + 8 + length));
    if (kind === "IEND") break;
    at += 12 + length;
  }
  if (parts.length === 0) return null;
  const { width, height, channels } = head;
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(inflateSync(join(parts)));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  return { width, height, channels, pixels: unfilter(raw, width, height, channels) };
}

/** The picture's pixels: each row is undone from what the row before it made of it (the PNG's own filters). */
function unfilter(raw: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)] ?? 0;
    const from = row * (stride + 1) + 1;
    const to = row * stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? (pixels[to + i - channels] ?? 0) : 0;
      const up = row > 0 ? (pixels[to - stride + i] ?? 0) : 0;
      const upLeft = row > 0 && i >= channels ? (pixels[to - stride + i - channels] ?? 0) : 0;
      pixels[to + i] = ((raw[from + i] ?? 0) + predict(filter, left, up, upLeft)) & 0xff;
    }
  }
  return pixels;
}

/** What the filter said the row was written against. */
function predict(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4:
      return paeth(left, up, upLeft);
    default:
      return 0;
  }
}

/** The PNG's own guess: whichever of the three is closest to what they add up to. */
function paeth(left: number, up: number, upLeft: number): number {
  const guess = left + up - upLeft;
  const distances = [Math.abs(guess - left), Math.abs(guess - up), Math.abs(guess - upLeft)];
  const [toLeft = 0, toUp = 0, toUpLeft = 0] = distances;
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

/** `width`×`height` pixels as a PNG, every row unfiltered (a crop's rows have no predecessor to lean on). */
function write(width: number, height: number, channels: number, pixels: Uint8Array): Uint8Array {
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let row = 0; row < height; row++) raw.set(pixels.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  const head = new Uint8Array(13);
  const view = new DataView(head.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  head[8] = 8;
  head[9] = channels === 4 ? 6 : 2;
  return join([new Uint8Array(signature), chunk("IHDR", head), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array(0))]);
}

function chunk(kind: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let at = 0; at < 4; at++) out[4 + at] = kind.charCodeAt(at);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
