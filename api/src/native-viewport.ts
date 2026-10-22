import type { Size } from "@amuse/browser";

/** Native pages use the viewer's CSS pixels so mobile media queries can reflow. */
export function nativeViewport(viewer: Size): Size {
  const scale = Math.min(1, 1920 / Math.max(viewer.width, viewer.height));
  return { width: Math.max(1, Math.round(viewer.width * scale)), height: Math.max(1, Math.round(viewer.height * scale)) };
}

/** CDP may deliver an old compositor frame after setViewportSize has resolved. */
export function sameViewport(frame: Size, viewport: Size): boolean {
  return Math.abs(frame.width - viewport.width) < 1 && Math.abs(frame.height - viewport.height) < 1;
}
