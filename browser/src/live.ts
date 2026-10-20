/**
 * The live view of a page: JPEG frames from Chromium's screencast, and the
 * user's input replayed into the page. Input arrives as protocol `Input`
 * with fractional coordinates and is scaled to the page here.
 */
import type { Input, Screen } from "@remuse/protocol";
import type { Page } from "playwright-core";

export type Frame = { kind: "frame"; jpeg: Buffer } | Screen;

/**
 * Stream frames (and screen changes) until the returned stop is called.
 * `ready` is backpressure: while it says no, frames are dropped and their
 * acknowledgement is delayed, so Chromium slows down instead of the server
 * buffering JPEGs for a slow client.
 */
export async function watch(page: Page, send: (frame: Frame) => void, ready: () => boolean = () => true): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  const screen = async () => {
    const size = page.viewportSize();
    if (size) send({ kind: "screen", ...size, url: page.url(), title: await page.title().catch(() => "") });
  };
  const ack = (sessionId: number) => void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
    if (!ready()) return void setTimeout(() => ack(sessionId), 100);
    send({ kind: "frame", jpeg: Buffer.from(data, "base64") });
    ack(sessionId);
  });
  const navigated = () => void screen();
  page.on("framenavigated", navigated);
  await screen();
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, everyNthFrame: 1 });
  return async () => {
    page.off("framenavigated", navigated);
    await cdp.send("Page.stopScreencast").catch(() => {});
    await cdp.detach().catch(() => {});
  };
}

export async function replay(page: Page, input: Input): Promise<void> {
  const size = page.viewportSize();
  if (!size) return;
  switch (input.kind) {
    case "pointer": {
      const x = input.x * size.width;
      const y = input.y * size.height;
      await page.mouse.move(x, y);
      if (input.action === "down") await page.mouse.down({ button: input.button });
      if (input.action === "up") await page.mouse.up({ button: input.button });
      return;
    }
    case "wheel":
      await page.mouse.move(input.x * size.width, input.y * size.height);
      await page.mouse.wheel(input.dx, input.dy);
      return;
    case "key":
      await (input.action === "down" ? page.keyboard.down(input.key) : page.keyboard.up(input.key));
      return;
    case "text":
      await page.keyboard.insertText(input.text);
      return;
  }
}
