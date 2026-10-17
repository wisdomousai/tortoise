"""What the driver did per effect ID, so retries and lookups survive a driver restart.

The host may send an effect again after a lost reply, and asks ``action.lookup`` before resending
a ``once`` action. Both answers have to come from what the equipment was told, not from memory
that a crash erased. The journal records ``started`` before the driver acts and the outcome after,
each line flushed and fsynced before the driver moves on. An effect that was started but has no
outcome is ``uncertain``: the driver may have acted, and a person decides.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

#: `released`: the handler refused before acting, so the effect may run again later.
Status = Literal["started", "released", "accepted", "rejected"]


@dataclass(frozen=True)
class Entry:
    effect_id: str
    action: str
    status: Status
    ref: str | None = None
    result: object = None
    code: str | None = None
    message: str | None = None


class Journal:
    """Effect outcomes, in memory and, when ``path`` is given, in an append-only file."""

    def __init__(self, path: str | os.PathLike[str] | None = None) -> None:
        self._entries: dict[str, Entry] = {}
        self._file = None
        if path is None:
            return
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            for line in target.read_text(encoding="utf-8").splitlines():
                # A torn last line from a crash mid-write is skipped: its effect stays started,
                # which reads as uncertain, the safe answer.
                try:
                    raw = json.loads(line)
                    entry = Entry(**raw)
                except (ValueError, TypeError):
                    continue
                self._entries[entry.effect_id] = entry
        self._file = open(target, "a", encoding="utf-8")

    @property
    def durable(self) -> bool:
        return self._file is not None

    def get(self, effect_id: str) -> Entry | None:
        return self._entries.get(effect_id)

    def record(self, entry: Entry) -> None:
        self._entries[entry.effect_id] = entry
        if self._file is None:
            return
        fields = {key: value for key, value in entry.__dict__.items() if value is not None}
        self._file.write(json.dumps(fields, ensure_ascii=False, separators=(",", ":")) + "\n")
        self._file.flush()
        os.fsync(self._file.fileno())

    def close(self) -> None:
        if self._file is not None:
            self._file.close()
            self._file = None
