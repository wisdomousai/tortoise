"""A hardware driver for an agent-native host.

The host starts the driver as a child process and speaks JSON-RPC to it over stdin and stdout.
This module answers the protocol so a driver author writes only what touches the equipment:

    driver = Driver(CONTRACT, DIGEST, driver_id="chamber", version="1.0.0")

    @driver.on_initialize
    async def open(configuration):
        return [Device(serial=port.serial)]

    @driver.on_state
    async def read(fields):
        return {"setpoint": port.setpoint()}

    @driver.action("setpoint.set")
    async def set_setpoint(input, context):
        port.write_setpoint(input["setpoint"])

    driver.run()

What the SDK enforces, whatever the handlers do:

- The mode the host sends with each action: ``monitor-only`` refuses every action, ``assist``
  refuses any hazard other than ``none``, and an ``operator-present`` action needs
  ``presence.confirmedBy``.
- An action whose deadline passed is refused before it runs.
- ``idempotent`` and ``once`` actions run at most once per effect ID. A repeat returns the
  recorded outcome; ``action.lookup`` answers from the journal. An effect that started and has no
  outcome (the driver crashed or the action raised) answers ``uncertain``, never ``unknown``.
- stdout carries only protocol messages: ``print`` goes to stderr while the driver runs.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import sys
import threading
import time
import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import asdict, dataclass, field
from typing import Any, BinaryIO, Literal

from .journal import Entry, Journal
from .rpc import LineReader, LineWriter

PROTOCOL = "1"

Kind = Literal["rejected", "precondition", "transient", "uncertain", "refused"]
Mode = Literal["monitor-only", "assist", "actuate"]
_modes = {"monitor-only", "assist", "actuate"}


class Refusal(Exception):
    """An answer that is not a result. Raise it from a handler to classify a failure.

    - ``rejected``: the equipment refused the request; retrying will not help. ``code`` is your
      business code, shown to the person who settles it.
    - ``precondition``: the equipment is not in a state to do it now.
    - ``transient``: nothing was done, and a retry may succeed (port busy, device warming up).
    - ``uncertain``: the equipment may have acted and the driver cannot tell. A person decides.
    - ``refused``: the mode or the driver's own rules do not allow it.

    Any other exception raised while acting reads as ``uncertain``, because the driver cannot know
    how far the equipment got. Raise ``Refusal("transient", ...)`` when you know nothing happened.
    """

    def __init__(self, kind: Kind, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message[:500]
        self.code = code[:64] if code else None


class _ProtocolError(Exception):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Device:
    """The unit the driver talks to, recorded with every reading the host takes from it."""

    serial: str | None = None
    firmware: str | None = None
    model: str | None = None

    def wire(self) -> dict[str, str]:
        return {key: value for key, value in asdict(self).items() if value}


@dataclass
class Reading:
    """State values, with the instrument's own confidence (0 to 1) where it reports one."""

    values: Mapping[str, Any]
    confidence: Mapping[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class ActionContext:
    effect_id: str
    mode: Mode
    #: Milliseconds since the epoch; the host stops waiting then.
    deadline: float | None
    session: str


@dataclass(frozen=True)
class ActionResult:
    """What an action handler may return besides ``None``: the equipment's reference and a result."""

    ref: str | None = None
    result: Any = None


ActionHandler = Callable[[Any, ActionContext], Awaitable[ActionResult | Mapping[str, Any] | None]]


def _now_ms() -> float:
    return time.time() * 1000


async def _call(handler: Callable[..., Any], *args: Any) -> Any:
    value = handler(*args)
    return await value if inspect.isawaitable(value) else value


class Driver:
    """One driver for one contract. Register handlers with the decorators, then call ``run``."""

    def __init__(
        self,
        contract: Mapping[str, Any],
        digest: str,
        *,
        driver_id: str,
        version: str,
        journal: str | None = None,
    ) -> None:
        self.contract = contract
        self.digest = digest
        self.driver_id = driver_id
        self.version = version
        self.journal = Journal(journal)
        actions = contract.get("actions", {})
        if not self.journal.durable and any(a.get("delivery") == "once" for a in actions.values()):
            raise ValueError(
                "This contract has once actions; pass journal= so lookups survive a restart"
            )
        self._actions: dict[str, ActionHandler] = {}
        self._initialize: Callable[..., Any] | None = None
        self._state: Callable[..., Any] | None = None
        self._health: Callable[..., Any] | None = None
        self._shutdown: Callable[..., Any] | None = None
        self._inflight: set[str] = set()
        self._last_emit: dict[str, float] = {}
        self.session: str | None = None
        self.mode: Mode = "monitor-only"
        self._seq = 0
        self._writer: LineWriter | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._loop_thread: int | None = None

    # Registration -------------------------------------------------------------------------------

    def on_initialize(self, handler: Callable[[Mapping[str, Any]], Any]) -> Callable:
        """Open the equipment with the host's configuration; return the ``Device`` units found."""
        self._initialize = handler
        return handler

    def on_state(self, handler: Callable[[list[str]], Any]) -> Callable:
        """Read the requested fields; return a dict of values or a ``Reading``."""
        self._state = handler
        return handler

    def on_health(self, handler: Callable[[], Any]) -> Callable:
        """Raise ``Refusal`` when the equipment link is broken; the host then restarts the driver."""
        self._health = handler
        return handler

    def on_shutdown(self, handler: Callable[[], Any]) -> Callable:
        """Release the equipment. Runs on ``shutdown`` and when the host goes away."""
        self._shutdown = handler
        return handler

    def action(self, name: str) -> Callable[[ActionHandler], ActionHandler]:
        if name not in self.contract.get("actions", {}):
            raise ValueError(f"The contract declares no action {name}")

        def register(handler: ActionHandler) -> ActionHandler:
            self._actions[name] = handler
            return handler

        return register

    # Events -------------------------------------------------------------------------------------

    def emit(self, name: str, payload: Any = None, device: int | None = None) -> bool:
        """Send a declared event. Safe from any thread. Returns False when dropped by ``maxRateHz``.

        Events before the handshake are dropped: the host has no session to order them in.
        """
        declared = self.contract.get("events", {}).get(name)
        if declared is None:
            raise ValueError(f"The contract declares no event {name}")
        if self._loop is not None and threading.get_ident() != self._loop_thread:
            self._loop.call_soon_threadsafe(self.emit, name, payload, device)
            return True
        if self.session is None or self._writer is None:
            return False
        now = _now_ms()
        rate = declared.get("maxRateHz")
        if rate and now - self._last_emit.get(name, float("-inf")) < 1000 / rate:
            return False
        self._last_emit[name] = now
        params: dict[str, Any] = {"session": self.session, "seq": self._seq, "name": name, "at": now}
        if payload is not None:
            params["payload"] = payload
        if device is not None:
            params["device"] = device
        self._seq += 1
        self._writer.send({"method": "event", "params": params})
        return True

    # Requests -----------------------------------------------------------------------------------

    async def handle(self, method: str, params: Mapping[str, Any]) -> Any:
        """Answer one request. Raises ``Refusal`` for a classified failure."""
        if method == "initialize":
            return await self._on_initialize(params)
        if self.session is None:
            raise Refusal("transient", "The driver has not been initialized")
        if method == "state.read":
            return await self._on_state(params)
        if method == "action.invoke":
            return await self._on_invoke(params)
        if method == "action.lookup":
            return self._on_lookup(params)
        if method == "health":
            if self._health:
                await _call(self._health)
            return {}
        if method == "shutdown":
            return {}
        raise _ProtocolError(-32601, f"Unknown method {method}")

    async def _on_initialize(self, params: Mapping[str, Any]) -> dict[str, Any]:
        if params.get("protocol") != PROTOCOL:
            raise Refusal("refused", f"This driver speaks protocol {PROTOCOL}")
        if params.get("contract", {}).get("id") != self.contract.get("id"):
            raise Refusal("refused", f"This driver implements {self.contract.get('id')}")
        mode = params.get("mode", "monitor-only")
        self.mode = mode if mode in _modes else "monitor-only"
        devices = await _call(self._initialize, params.get("configuration", {})) if self._initialize else []
        self.session = uuid.uuid4().hex
        self._seq = 0
        return {
            "driver": {"id": self.driver_id, "version": self.version},
            "contract": {"digest": self.digest},
            "session": self.session,
            "devices": [device.wire() for device in devices or []],
        }

    async def _on_state(self, params: Mapping[str, Any]) -> dict[str, Any]:
        fields = [name for name in params.get("fields", []) if name in self.contract.get("state", {})]
        if self._state is None:
            raise Refusal("rejected", "This driver reads no state")
        answer = await _call(self._state, fields)
        reading = answer if isinstance(answer, Reading) else Reading(values=answer or {})
        return {
            "values": {name: reading.values[name] for name in fields if name in reading.values},
            "confidence": {
                name: min(1.0, max(0.0, float(value)))
                for name, value in reading.confidence.items()
                if name in fields
            },
            "at": _now_ms(),
        }

    def _gate(self, name: str, spec: Mapping[str, Any], input: Any, mode: str, deadline: Any) -> None:
        """The host's own checks, repeated, so a driver is safe even behind a faulty host."""
        hazard = spec.get("hazard", "operator-present")
        if mode not in _modes or mode == "monitor-only":
            raise Refusal("refused", f"Mode {mode} does not allow {name}")
        if mode == "assist" and hazard != "none":
            raise Refusal("refused", f"{name} needs actuate mode")
        if hazard == "operator-present":
            presence = input.get("presence") if isinstance(input, Mapping) else None
            if not (isinstance(presence, Mapping) and presence.get("confirmedBy")):
                raise Refusal("precondition", f"{name} needs a person at the machine to confirm")
        if isinstance(deadline, (int, float)) and _now_ms() > deadline:
            raise Refusal("transient", f"The deadline for {name} passed before it ran")

    def _replay(self, name: str, spec: Mapping[str, Any], effect_id: str) -> dict[str, Any] | None:
        """The recorded outcome of an effect that must not run twice, or None to run it."""
        if spec.get("delivery") == "convergent":
            # The host reads the equipment back before resending a convergent action; acting
            # again is its decision.
            return None
        entry = self.journal.get(effect_id)
        if entry is None or entry.status == "released":
            return None
        if entry.action != name:
            raise Refusal("rejected", f"Effect {effect_id} was used for {entry.action}", "EFFECT_REUSED")
        if entry.status == "accepted":
            return _invoke_answer(entry.ref, entry.result)
        if entry.status == "rejected":
            raise Refusal("rejected", entry.message or "Rejected", entry.code)
        raise Refusal("uncertain", f"The driver stopped while running {name} for this effect")

    async def _on_invoke(self, params: Mapping[str, Any]) -> dict[str, Any]:
        name = params.get("action")
        effect_id = params.get("effectId")
        spec = self.contract.get("actions", {}).get(name)
        if not isinstance(effect_id, str) or not effect_id:
            raise _ProtocolError(-32602, "action.invoke needs an effectId")
        if spec is None or name not in self._actions:
            raise Refusal("rejected", f"This driver has no action {name}", "UNKNOWN_ACTION")
        input = params.get("input")
        mode = params.get("mode", "monitor-only")
        self._gate(name, spec, input, mode, params.get("deadline"))
        replayed = self._replay(name, spec, effect_id)
        if replayed is not None:
            return replayed
        if effect_id in self._inflight:
            raise Refusal("transient", f"Effect {effect_id} is already running")
        self._inflight.add(effect_id)
        self.journal.record(Entry(effect_id, name, "started"))
        try:
            context = ActionContext(effect_id, mode, params.get("deadline"), self.session or "")
            outcome = await _call(self._actions[name], input, context)
        except Refusal as refusal:
            if refusal.kind == "rejected":
                self.journal.record(
                    Entry(effect_id, name, "rejected", code=refusal.code or "REJECTED", message=refusal.message)
                )
            elif refusal.kind in ("precondition", "transient", "refused"):
                self.journal.record(Entry(effect_id, name, "released"))
            raise
        except asyncio.CancelledError:
            raise
        except Exception as error:
            print(f"{name} failed while acting: {error!r}", file=sys.stderr)
            raise Refusal("uncertain", f"{name} failed while acting") from error
        finally:
            self._inflight.discard(effect_id)
        if isinstance(outcome, ActionResult):
            ref, result = outcome.ref, outcome.result
        elif isinstance(outcome, Mapping):
            ref, result = outcome.get("ref"), outcome.get("result")
        else:
            ref, result = None, None
        self.journal.record(Entry(effect_id, name, "accepted", ref=ref, result=result))
        return _invoke_answer(ref, result)

    def _on_lookup(self, params: Mapping[str, Any]) -> dict[str, Any]:
        entry = self.journal.get(str(params.get("effectId")))
        if entry is None or entry.status == "released":
            return {"status": "unknown"}
        if entry.status == "accepted":
            return {"status": "accepted", **({"ref": entry.ref} if entry.ref else {})}
        if entry.status == "rejected":
            return {
                "status": "rejected",
                "code": entry.code or "REJECTED",
                "message": entry.message or "Rejected",
            }
        return {"status": "uncertain", "reason": f"The driver stopped while running {entry.action}"}

    # Serving ------------------------------------------------------------------------------------

    async def serve(self, input: BinaryIO, output: BinaryIO) -> None:
        """Answer requests from ``input`` until ``shutdown`` or end of input."""
        self._loop = asyncio.get_running_loop()
        self._loop_thread = threading.get_ident()
        self._writer = LineWriter(output)
        reader = LineReader(input, self._loop)
        tasks: dict[Any, asyncio.Task] = {}
        stopping = False
        while not stopping:
            line = await reader.next()
            if line is None:
                break
            message = _parse(line)
            if message is None:
                print("Ignored a line that is not a JSON-RPC message", file=sys.stderr)
                continue
            method, params, request_id = message
            if request_id is None:
                if method == "$/cancel":
                    task = tasks.get(params.get("id"))
                    if task:
                        task.cancel()
                continue
            stopping = method == "shutdown"
            task = asyncio.create_task(self._answer(request_id, method, params))
            tasks[request_id] = task
            task.add_done_callback(lambda _, key=request_id: tasks.pop(key, None))
        if tasks:
            await asyncio.gather(*tasks.values(), return_exceptions=True)
        if self._shutdown:
            await _call(self._shutdown)
        self.journal.close()

    async def _answer(self, request_id: Any, method: str, params: Mapping[str, Any]) -> None:
        assert self._writer is not None
        try:
            result = await self.handle(method, params)
            self._writer.send({"id": request_id, "result": result})
        except Refusal as refusal:
            data: dict[str, str] = {"kind": refusal.kind}
            if refusal.code:
                data["code"] = refusal.code
            self._writer.send({"id": request_id, "error": {"code": -32000, "message": refusal.message, "data": data}})
        except _ProtocolError as error:
            self._writer.send(
                {"id": request_id, "error": {"code": error.code, "message": error.message, "data": {"kind": "rejected"}}}
            )
        except asyncio.CancelledError:
            self._writer.send(
                {"id": request_id, "error": {"code": -32800, "message": f"{method} was cancelled", "data": {"kind": "transient"}}}
            )
        except Exception as error:
            print(f"{method} failed: {error!r}", file=sys.stderr)
            self._writer.send(
                {"id": request_id, "error": {"code": -32603, "message": f"{method} failed", "data": {"kind": "transient"}}}
            )

    def run(self) -> int:
        """Serve on stdin and stdout. ``print`` goes to stderr from here on."""
        protocol_out = sys.stdout.buffer
        sys.stdout = sys.stderr
        asyncio.run(self.serve(sys.stdin.buffer, protocol_out))
        return 0


def _invoke_answer(ref: str | None, result: Any) -> dict[str, Any]:
    answer: dict[str, Any] = {}
    if ref:
        answer["ref"] = str(ref)[:256]
    if result is not None:
        answer["result"] = result
    return answer


def _parse(line: bytes) -> tuple[str, Mapping[str, Any], Any] | None:
    try:
        message = json.loads(line)
    except ValueError:
        return None
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        return None
    method = message.get("method")
    params = message.get("params", {})
    if not isinstance(method, str) or not isinstance(params, dict):
        return None
    return method, params, message.get("id")
