/**
 * A device as a person tells it apart: what it is and which browser, from the User-Agent the server kept when it
 * signed in ("iPhone · Safari", "Mac · Chrome"). Only for showing; nothing is decided by it.
 */

/** What kind of device: for its icon. */
export type DeviceKind = "phone" | "tablet" | "computer";

export interface Described {
  kind: DeviceKind;
  /** "iPhone · Safari"; empty when the browser said nothing (a device signed in before devices were known) */
  name: string;
}

const SYSTEMS: [RegExp, string, DeviceKind][] = [
  [/iPhone/, "iPhone", "phone"],
  [/iPad/, "iPad", "tablet"],
  [/Android.*Mobile/, "Android", "phone"],
  [/Android/, "Android tablet", "tablet"],
  [/CrOS/, "Chromebook", "computer"],
  [/Mac OS X|Macintosh/, "Mac", "computer"],
  [/Windows/, "Windows", "computer"],
  [/Linux/, "Linux", "computer"],
];

// the order matters: Edge and Opera say Chrome too, and Chrome says Safari
const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

export function describeDevice(agent: string): Described {
  const system = SYSTEMS.find(([pattern]) => pattern.test(agent));
  const browser = BROWSERS.find(([pattern]) => pattern.test(agent))?.[1];
  const name = [system?.[1], browser].filter(Boolean).join(" · ");
  return { kind: system?.[2] ?? "computer", name };
}
