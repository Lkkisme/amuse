"""
A terminal for the daemon to relay: runs a command in a pseudo-terminal of
its own and passes bytes both ways (what is typed on stdin, what the terminal
shows on stdout). Its size comes as the first two arguments and then, while it
runs, as lines "<cols> <rows>" on fd 3. Ends when the command does, or when
stdin closes (the viewer left), which hangs the terminal up.

    python3 -I terminal_relay.py <cols> <rows> <command> [args...]

Node has no pseudo-terminal of its own without a native module; Python's is
in its standard library, and Python is in the sandbox's image.
"""

import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios
import time


def size(fd: int, cols: int, rows: int) -> None:
    # the kernel tells the terminal's foreground programs (SIGWINCH)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def sane(cols: int, rows: int) -> bool:
    return 1 <= cols <= 1000 and 1 <= rows <= 500


def given(fd: int) -> bool:
    try:
        os.fstat(fd)
        return True
    except OSError:
        return False


def write_all(fd: int, data: bytes) -> None:
    while data:
        data = data[os.write(fd, data):]


def main() -> int:
    cols, rows = int(sys.argv[1]), int(sys.argv[2])
    command = sys.argv[3:]
    # sizes come on fd 3 when it was given; asked before the terminal is opened, which may take that number itself
    sizes = 3 if given(3) else None
    pid, terminal = pty.fork()
    if pid == 0:
        # The child may exec before the parent is scheduled. Programs such as
        # herdr inspect their grid immediately and refuse a zero-sized PTY.
        # Set it on the slave too, before any command starts reading it.
        if sane(cols, rows):
            size(0, cols, rows)
        os.environ["TERM"] = "xterm-256color"
        os.environ["COLORTERM"] = "truecolor"
        os.execvp(command[0], command)
    if sane(cols, rows):
        size(terminal, cols, rows)
    pending = b""
    watched = [terminal, 0] + ([sizes] if sizes is not None else [])
    try:
        while True:
            ready, _, _ = select.select(watched, [], [])
            if terminal in ready:
                try:
                    data = os.read(terminal, 65536)
                except OSError:
                    break  # the command is gone (EIO)
                if not data:
                    break
                write_all(1, data)
            if 0 in ready:
                data = os.read(0, 65536)
                if not data:
                    break
                write_all(terminal, data)
            if sizes is not None and sizes in ready:
                data = os.read(sizes, 4096)
                if not data:
                    watched.remove(sizes)
                    sizes = None
                    continue
                pending += data
                *lines, pending = pending.split(b"\n")
                for line in lines:
                    parts = line.split()
                    if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit() and sane(int(parts[0]), int(parts[1])):
                        size(terminal, int(parts[0]), int(parts[1]))
    except (BrokenPipeError, KeyboardInterrupt):
        pass
    return end(pid)


def end(pid: int) -> int:
    """The command's exit code: hung up if it is still there, and killed if that does not end it."""
    for attempt in range(41):
        done, status = os.waitpid(pid, os.WNOHANG)
        if done:
            return os.waitstatus_to_exitcode(status)
        if attempt == 0:
            os.kill(pid, signal.SIGHUP)
        time.sleep(0.05)
    os.kill(pid, signal.SIGKILL)
    return os.waitstatus_to_exitcode(os.waitpid(pid, 0)[1])


if __name__ == "__main__":
    sys.exit(main())
