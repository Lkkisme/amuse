export type Size = { width: number; height: number };
export type Generation = string | number;
export type Frame = Size & { generation: Generation };

export function frameOf(value: unknown): Frame | null {
  if (typeof value !== "object" || value === null || !("type" in value) || value.type !== "frame" ||
    !("width" in value) || typeof value.width !== "number" || !Number.isFinite(value.width) || value.width <= 0 ||
    !("height" in value) || typeof value.height !== "number" || !Number.isFinite(value.height) || value.height <= 0 ||
    !("generation" in value) || (typeof value.generation !== "string" && typeof value.generation !== "number")) return null;
  return { width: value.width, height: value.height, generation: value.generation };
}

/** Includes height-only changes from the keyboard and the takeover controls. */
export function changedViewport(next: Size, previous: Size | null): boolean {
  return !previous || Math.abs(next.width - previous.width) >= 1 || Math.abs(next.height - previous.height) >= 1;
}

/** The JPEG can be smaller than the CSS viewport, but must have the same shape. */
export function frameFits(image: Size, viewport: Size): boolean {
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
  // CDP rounds each scaled JPEG side independently, by at most one source pixel.
  return Math.abs(image.width * scale - viewport.width) <= Math.max(2, scale * 2) &&
    Math.abs(image.height * scale - viewport.height) <= Math.max(2, scale * 2);
}

/** Keep these caps aligned with native-browser.ts's Page.startScreencast.
 * CDP can label a transitional, much smaller JPEG with the new viewport.
 * A phone needs the full CSS resolution; a wide desktop may legitimately hit
 * the existing 1280 × 1920 stream caps. Allow one pixel of rounding per side.
 */
export function nativeFrameHasResolution(image: Size, viewport: Size): boolean {
  const scale = Math.min(1, 1280 / viewport.width, 1920 / viewport.height);
  return image.width >= Math.floor(viewport.width * scale) - 1 &&
    image.height >= Math.floor(viewport.height * scale) - 1;
}

/** Always draw with one scale, even while compositor dimensions settle. */
export function contained(image: Size, viewport: Size) {
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
  const width = image.width * scale, height = image.height * scale;
  return { x: (viewport.width - width) / 2, y: (viewport.height - height) / 2, width, height };
}
