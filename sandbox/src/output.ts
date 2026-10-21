/**
 * Output kept within bounds: the first and the last of it, with a count of
 * what fell out between, so a runaway command cannot fill the daemon's memory
 * and a long build log still shows how it began and how it ended.
 */
export class Clip {
  private head = "";
  private tail = "";
  private left = 0;
  private readonly first: number;
  private readonly last: number;

  /** Keeps the first `first` characters and the last `last`. */
  constructor(first: number, last: number) {
    this.first = first;
    this.last = last;
  }

  append(text: string): void {
    const room = this.first - this.head.length;
    if (room > 0) {
      this.head += text.slice(0, room);
      text = text.slice(room);
    }
    this.tail += text;
    // trimmed in steps, not on every chunk
    if (this.tail.length > this.last * 2) {
      this.left += this.tail.length - this.last;
      this.tail = this.tail.slice(-this.last);
    }
  }

  /** What is kept, and how many characters were left out between its two ends. */
  result(): { output: string; cut: number } {
    const extra = Math.max(0, this.tail.length - this.last);
    const cut = this.left + extra;
    const tail = extra > 0 ? this.tail.slice(extra) : this.tail;
    return { output: cut > 0 ? `${this.head}\n… ${cut} characters left out …\n${tail}` : this.head + tail, cut };
  }
}

/** The last `count` lines of `text` (all of it when it is shorter). */
export function lastLines(text: string, count: number): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(-count).join("\n");
}
