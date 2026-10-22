import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

test("a terminal command sees its initial grid even when the parent has not been scheduled", { skip: process.platform === "win32" }, () => {
  const relay = join(import.meta.dirname, "terminal_relay.py");
  // Delay only the parent's return from fork, so the command reads its size
  // before the parent can set it. This reproduces herdr's startup failure.
  const delayedParent = `
import pty, runpy, sys, time
original = pty.fork
def fork():
    pid, terminal = original()
    if pid:
        time.sleep(0.2)
    return pid, terminal
pty.fork = fork
sys.argv = [sys.argv[1], '91', '37', 'python3', '-c', 'import os; print(os.get_terminal_size(0))']
runpy.run_path(sys.argv[0], run_name='__main__')
`;
  const result = spawnSync("python3", ["-I", "-c", delayedParent, relay], { encoding: "utf8", timeout: 5_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /columns=91, lines=37/);
});
