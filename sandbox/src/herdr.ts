/**
 * herdr's socket API, as the daemon uses it: one request, one answer, as
 * lines of JSON on the server's socket (~/.config/herdr/herdr.sock). The
 * daemon is root and can open the user's socket; what herdr answers is the
 * sandbox's, so it is checked like anything else from there.
 */
import { createConnection } from "node:net";
import { z } from "zod";

// the error first: a missing `result` would pass as unknown
const Answer = z.union([
  z.object({ error: z.object({ message: z.string().max(2000).optional() }).loose() }),
  z.object({ result: z.unknown() }),
]);

/** herdr said no, or could not be asked; `message` is herdr's own (untrusted), when it said one. */
export class HerdrError extends Error {}

/** The result of `method` with `params`, or a HerdrError; given up on after `ms`. */
export function herdrCall(socket: string, method: string, params: Record<string, unknown>, ms = 5_000): Promise<unknown> {
  return new Promise((done, failed) => {
    const connection = createConnection(socket);
    let text = "";
    const fail = (message: string) => {
      connection.destroy();
      failed(new HerdrError(message));
    };
    const timer = setTimeout(() => fail("herdr did not answer in time."), ms);
    connection.setEncoding("utf8");
    connection.on("connect", () => connection.write(`${JSON.stringify({ id: "amuse", method, params })}\n`));
    connection.on("error", () => fail("herdr is not running."));
    connection.on("data", (chunk: string) => {
      text += chunk;
      if (text.length > 1024 ** 2) return fail("herdr's answer was too large.");
      const end = text.indexOf("\n");
      if (end < 0) return;
      clearTimeout(timer);
      connection.end();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text.slice(0, end));
      } catch {
        return failed(new HerdrError("herdr's answer could not be read."));
      }
      const answer = Answer.safeParse(parsed);
      if (!answer.success) return failed(new HerdrError("herdr's answer could not be understood."));
      if ("error" in answer.data) return failed(new HerdrError(answer.data.error.message ?? "herdr refused."));
      done(answer.data.result);
    });
  });
}
