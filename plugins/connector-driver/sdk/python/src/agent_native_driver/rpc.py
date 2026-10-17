"""JSON-RPC 2.0 framing over a pair of byte streams, one message per line.

Reading runs on a thread because a pipe on stdin is not portably awaitable (Windows' selector
loop cannot watch it); each line is handed to the event loop. Writing happens on the loop thread
only, so messages never interleave.
"""

from __future__ import annotations

import asyncio
import json
import threading
from typing import BinaryIO

#: The longest line accepted from the host. Longer lines are dropped, not buffered without bound.
MAX_LINE = 1 << 20


class LineReader:
    """Lines from ``stream`` as an async iterator; ``None`` marks end of input."""

    def __init__(self, stream: BinaryIO, loop: asyncio.AbstractEventLoop) -> None:
        self._queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._loop = loop
        thread = threading.Thread(target=self._pump, args=(stream,), daemon=True)
        thread.start()

    def _pump(self, stream: BinaryIO) -> None:
        try:
            while True:
                line = stream.readline(MAX_LINE + 1)
                if not line:
                    break
                if len(line) > MAX_LINE and not line.endswith(b"\n"):
                    # Discard the rest of an oversized line.
                    while line and not line.endswith(b"\n"):
                        line = stream.readline(MAX_LINE + 1)
                    continue
                self._loop.call_soon_threadsafe(self._queue.put_nowait, line)
        finally:
            self._loop.call_soon_threadsafe(self._queue.put_nowait, None)

    async def next(self) -> bytes | None:
        return await self._queue.get()


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
