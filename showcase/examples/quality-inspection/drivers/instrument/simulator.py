"""A simulated instrument on a pseudo-terminal pair, so the driver's real serial code runs without
hardware. Standard library only; POSIX (macOS and Linux).

It prints the device path the driver should open as its first line on stdout, then copies each
line it reads on stdin to the instrument side, ending it in CR LF as an instrument would:

    ST,+00012.031 mm

The line ``unplug`` closes the instrument side, as pulling the cable would. End of input stops
the simulator.
"""

from __future__ import annotations

import os
import pty
import sys
import tty


def main() -> int:
    instrument, device = pty.openpty()
    # Raw on both sides: no echo and no line editing, like a serial line.
    tty.setraw(instrument)
    tty.setraw(device)
    print(os.ttyname(device), flush=True)
    for line in sys.stdin:
        text = line.rstrip("\r\n")
        if text == "unplug":
            os.close(instrument)
            instrument = -1
            continue
        if instrument >= 0:
            os.write(instrument, text.encode("ascii") + b"\r\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
