/**
 * A gate on what a VNC viewer may send. The live view relays noVNC's RFB
 * stream; this parses the client→server side (handshake, then messages by
 * their RFB lengths) and drops input — keys, pointer, clipboard — unless the
 * user holds the run, and drops desktop resizes always (the desktop keeps
 * its size, so the agent's view of the page stays valid). A message it does
 * not know ends the stream: nothing unparsed is ever forwarded.
 * Handshake assumed: RFB 3.8 with security type None (the nodes set no VNC password).
 */

type Phase = { kind: "version" } | { kind: "security" } | { kind: "init" } | { kind: "messages" };

/** Bytes a client message of `type` occupies, given what has arrived; null until the length is known. */
function messageLength(type: number, b: Uint8Array): number | null | "unknown" {
  const byte = (at: number) => b[at] ?? 0; // only read after the length check below
  const u8 = (at: number) => (b.length > at ? byte(at) : null);
  const u16 = (at: number) => (b.length >= at + 2 ? (byte(at) << 8) | byte(at + 1) : null);
  const s32 = (at: number) => (b.length >= at + 4 ? (byte(at) << 24) | (byte(at + 1) << 16) | (byte(at + 2) << 8) | byte(at + 3) : null);
  switch (type) {
    case 0: // SetPixelFormat
      return 20;
    case 2: {
      const n = u16(2); // SetEncodings
      return n === null ? null : 4 + 4 * n;
    }
    case 3: // FramebufferUpdateRequest
      return 10;
    case 4: // KeyEvent
      return 8;
    case 5: // PointerEvent
      return 6;
    case 6: {
      const n = s32(4); // ClientCutText; a negative length is the extended clipboard format, |n| bytes
      return n === null ? null : 8 + Math.abs(n);
    }
    case 150: // EnableContinuousUpdates
      return 10;
    case 248: {
      const n = u8(8); // ClientFence
      return n === null ? null : 9 + n;
    }
    case 251: {
      const n = u8(6); // SetDesktopSize
      return n === null ? null : 8 + 16 * n;
    }
    case 255: {
      const subtype = u8(1); // QEMU client message; noVNC sends keys this way when the server offers it
      return subtype === null ? null : subtype === 0 ? 12 : "unknown"; // 0: QEMU extended key event
    }
    default:
      return "unknown";
  }
}

/** keys (plain and QEMU extended), pointer, clipboard */
const input = new Set([4, 5, 6, 255]);
const resize = 251;

export interface Gate {
  /** Feed client bytes; returns what may go on to the server, or "close" on anything unparsable. */
  pass(chunk: Uint8Array, controlled: boolean): Uint8Array | "close";
}

export function vncGate(): Gate {
  let phase: Phase = { kind: "version" };
  let pending = new Uint8Array(0);

  return {
    pass(chunk, controlled) {
      const joined = new Uint8Array(pending.length + chunk.length);
      joined.set(pending);
      joined.set(chunk, pending.length);
      const out: Uint8Array[] = [];
      let at = 0;
      for (;;) {
        const rest = joined.subarray(at);
        let size: number;
        let keep = true;
        if (phase.kind === "version") size = 12;
        else if (phase.kind === "security" || phase.kind === "init") size = 1;
        else {
          const type = rest[0];
          if (type === undefined) break;
          const length = messageLength(type, rest);
          if (length === "unknown") return "close";
          if (length === null) break;
          size = length;
          keep = type === resize ? false : input.has(type) ? controlled : true;
        }
        if (rest.length < size) break;
        if (keep) out.push(rest.subarray(0, size));
        at += size;
        phase = phase.kind === "version" ? { kind: "security" } : phase.kind === "security" ? { kind: "init" } : { kind: "messages" };
      }
      pending = joined.slice(at);
      const total = out.reduce((n, part) => n + part.length, 0);
      const passed = new Uint8Array(total);
      let offset = 0;
      for (const part of out) {
        passed.set(part, offset);
        offset += part.length;
      }
      return passed;
    },
  };
}
