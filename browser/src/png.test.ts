import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { cropPng, pngSize } from "./png.ts";

const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG of `rows` (three bytes a pixel), each row written with the filter `filters` names there: a browser's own. */
function pngOf(rows: number[][], filters: number[] = [], color = 2): Uint8Array {
  const head = new Uint8Array(13);
  const view = new DataView(head.buffer);
  view.setUint32(0, (rows[0]?.length ?? 0) / 3);
  view.setUint32(4, rows.length);
  head[8] = 8;
  head[9] = color;
  const raw: number[] = [];
  rows.forEach((row, y) => {
    const filter = filters[y] ?? 0;
    const before = rows[y - 1] ?? [];
    raw.push(filter, ...row.map((value, i) => (value - guess(filter, i >= 3 ? (row[i - 3] ?? 0) : 0, before[i] ?? 0, i >= 3 ? (before[i - 3] ?? 0) : 0)) & 0xff));
  });
  return join([new Uint8Array(signature), chunk("IHDR", head), chunk("IDAT", new Uint8Array(deflateSync(new Uint8Array(raw)))), chunk("IEND", new Uint8Array(0))]);
}

/** The PNG's own filter, from the writing side: the reading side is what is under test. */
function guess(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4: {
      const near = left + up - upLeft;
      const [toLeft, toUp, toUpLeft] = [Math.abs(near - left), Math.abs(near - up), Math.abs(near - upLeft)];
      if (toLeft <= toUp && toLeft <= toUpLeft) return left;
      return toUp <= toUpLeft ? up : upLeft;
    }
    default:
      return 0;
  }
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

/** The rows of a PNG these tests wrote (every row unfiltered), read back to compare pixel for pixel. */
function rows(png: Uint8Array): number[][] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const parts: Uint8Array[] = [];
  for (let at = 8; at + 12 <= png.length; ) {
    const length = view.getUint32(at);
    if (String.fromCharCode(...png.subarray(at + 4, at + 8)) === "IDAT") parts.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = new Uint8Array(inflateSync(join(parts)));
  const stride = width * 3;
  return Array.from({ length: height }, (_, y) => {
    assert.equal(raw[y * (stride + 1)], 0, "a crop is written unfiltered");
    return [...raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))];
  });
}

/** Three rows of three pixels: what is where a crop can be checked against. */
const picture = [
  [1, 2, 3, 4, 5, 6, 7, 8, 9],
  [10, 11, 12, 13, 14, 15, 16, 17, 18],
  [19, 20, 21, 22, 23, 24, 25, 26, 27],
];

test("a picture is cut down to an element's box, whatever filters its rows were written with", () => {
  const png = pngOf(picture, [0, 1, 2, 3, 4]);
  assert.deepEqual(pngSize(png), { width: 3, height: 3 });
  const whole = cropPng(png, { x: 0, y: 0, width: 3, height: 3 });
  assert.ok(whole);
  assert.deepEqual(rows(whole), picture, "the whole picture is the picture");
  const box = cropPng(png, { x: 1, y: 1, width: 2, height: 2 });
  assert.ok(box);
  assert.deepEqual(pngSize(box), { width: 2, height: 2 });
  assert.deepEqual(rows(box), [
    [13, 14, 15, 16, 17, 18],
    [22, 23, 24, 25, 26, 27],
  ]);
  // a box with room to spare is what is in the picture of it, not nothing
  const clamped = cropPng(png, { x: 2, y: 2, width: 40, height: 40 });
  assert.ok(clamped);
  assert.deepEqual(pngSize(clamped), { width: 1, height: 1 });
  assert.deepEqual(rows(clamped), [[25, 26, 27]]);
});

test("a box that is not on the picture, and a picture this cannot read, are left alone", () => {
  const png = pngOf(picture, [0, 1, 2]);
  assert.equal(cropPng(png, { x: 5, y: 0, width: 2, height: 2 }), null, "past its right edge");
  assert.equal(cropPng(png, { x: 0, y: 9, width: 2, height: 2 }), null, "below it");
  assert.equal(cropPng(png, { x: 1, y: 1, width: 0, height: 2 }), null, "nothing wide");
  assert.equal(cropPng(new Uint8Array([1, 2, 3]), { x: 0, y: 0, width: 1, height: 1 }), null, "not a PNG");
  assert.equal(pngSize(new Uint8Array(0)), null);
  // a picture in a shape this does not read (a palette, sixteen bits a channel, interlaced): left alone, never guessed at
  assert.equal(pngSize(pngOf(picture, [0], 3)), null, "palette");
  const deeper = pngOf(picture, [0]);
  deeper[24] = 16;
  assert.equal(pngSize(deeper), null, "sixteen bits a channel is not what a screenshot is");
  const interlaced = pngOf(picture, [0]);
  interlaced[28] = 1;
  assert.equal(cropPng(interlaced, { x: 0, y: 0, width: 1, height: 1 }), null);
});
