"""JSON-RPC 2.0 framing over a pair of byte streams, one message per line.

Reading runs on a thread because a pipe on stdin is not portably awaitable (Windows' selector
loop cannot watch it); each line is handed to the event loop. Writing happens on the loop thread
only, so messages never interleave.

The thread reads the file descriptor with ``os.read`` and splits lines itself. A thread blocked in
a buffered ``readline`` holds the buffer's lock, and an interpreter that exits after ``shutdown``
while the host still holds stdin open then aborts ("could not acquire lock ... at interpreter
shutdown"). ``os.read`` holds no Python lock, so the process exits cleanly.
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
from typing import BinaryIO, Callable

#: The longest line accepted from the host. Longer lines are dropped, not buffered without bound.
MAX_LINE = 1 << 20
_CHUNK = 1 << 16


class LineReader:
    """Lines from ``stream`` as an async iterator; ``None`` marks end of input."""

    def __init__(self, stream: BinaryIO, loop: asyncio.AbstractEventLoop) -> None:
        self._queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._loop = loop
        thread = threading.Thread(target=self._pump, args=(_chunks(stream),), daemon=True)
        thread.start()

    def _pump(self, read: Callable[[], bytes]) -> None:
        pending = b""
        oversized = False
        try:
            while chunk := read():
                pending += chunk
                while (end := pending.find(b"\n")) >= 0:
                    line, pending = pending[: end + 1], pending[end + 1 :]
                    if oversized or len(line) > MAX_LINE:
                        oversized = False
                        continue
                    self._loop.call_soon_threadsafe(self._queue.put_nowait, line)
                if len(pending) > MAX_LINE:
                    # Discard an oversized line up to its newline.
                    pending, oversized = b"", True
            if pending and not oversized:
                # A last line without a newline before end of input.
                self._loop.call_soon_threadsafe(self._queue.put_nowait, pending)
        except OSError:
            pass
        finally:
            self._loop.call_soon_threadsafe(self._queue.put_nowait, None)

    async def next(self) -> bytes | None:
        return await self._queue.get()


def _chunks(stream: BinaryIO) -> Callable[[], bytes]:
    """Read from the descriptor when there is one, so no buffered reader lock is ever held."""
    try:
        descriptor = stream.fileno()
    except (AttributeError, OSError, ValueError):
        return lambda: stream.read1(_CHUNK)  # type: ignore[attr-defined]
    return lambda: os.read(descriptor, _CHUNK)


class LineWriter:
    """Writes one JSON-RPC message per line and flushes it at once."""

    def __init__(self, stream: BinaryIO) -> None:
        self._stream = stream
        self._closed = False

    def send(self, message: dict) -> None:
        if self._closed:
            return
        body = json.dumps({"jsonrpc": "2.0", **message}, ensure_ascii=False, separators=(",", ":"))
        try:
            self._stream.write(body.encode("utf-8") + b"\n")
            self._stream.flush()
        except (BrokenPipeError, ValueError):
            # The host is gone; nothing more can be said to it.
            self._closed = True
