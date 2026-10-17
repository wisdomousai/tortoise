"""A simulated test chamber, written with the SDK, for the host's conformance tests.

It implements the reference chamber contract, ``chamber`` in
``plugins/connector-driver/src/testing/chamber.ts``. Generate its stub first, then run it with the
stub on ``PYTHONPATH``:

    app driver contract chamber --out chamber.json
    python -m agent_native_driver.stubgen chamber.json -o chamber_contract.py
    CHAMBER_SIM_DIR=/tmp/chamber python chamber_sim.py

``CHAMBER_SIM_DIR`` holds what a real chamber would keep across a driver restart (its setpoint and
door), the driver's journal, and test controls: an empty ``fail-next`` file makes the next action
fail before it acts, and ``crash-next`` makes it act and then exit before answering. Applied
actions are counted in ``applied.json``.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from agent_native_driver import ActionResult, Device, Driver, Refusal

from chamber_contract import CONTRACT, DIGEST, CycleStartInput, LabelPrintInput, SetpointSetInput

home = Path(os.environ["CHAMBER_SIM_DIR"])
home.mkdir(parents=True, exist_ok=True)
equipment_file = home / "equipment.json"
applied_file = home / "applied.json"

driver = Driver(CONTRACT, DIGEST, driver_id="chamber-sim", version="0.1.0", journal=str(home / "journal.jsonl"))


def load(path: Path, default: dict) -> dict:
    return json.loads(path.read_text()) if path.exists() else dict(default)


def save(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value))


def control(name: str) -> bool:
    """Consume a one-shot test control file."""
    path = home / name
    if path.exists():
        path.unlink()
        return True
    return False


def act(effect_id: str, change: dict | None = None) -> None:
    """Apply to the simulated equipment and count it, then honor ``crash-next``."""
    if change:
        save(equipment_file, {**load(equipment_file, initial), **change})
    applied = load(applied_file, {})
    applied[effect_id] = applied.get(effect_id, 0) + 1
    save(applied_file, applied)
    if control("crash-next"):
        os._exit(3)


def refuse_marked(input: dict) -> None:
    if "refuse" in json.dumps(input):
        raise Refusal("rejected", "Out of range", "OUT_OF_RANGE")


initial = {"setpoint": 20, "door": "closed", "control": "remote"}


@driver.on_initialize
def open_chamber(configuration: dict) -> list[Device]:
    return [Device(serial="CH-0042", firmware="3.1")]


@driver.on_state
def read(fields: list[str]) -> dict:
    return load(equipment_file, initial)


def before_acting() -> None:
    if control("fail-next"):
        raise Refusal("transient", "The chamber did not answer")


@driver.action("setpoint.set")
def set_setpoint(input: SetpointSetInput, context) -> None:
    before_acting()
    if input["setpoint"] > 300:
        raise Refusal("rejected", "Out of range", "OUT_OF_RANGE")
    act(context.effect_id, {"setpoint": input["setpoint"]})


@driver.action("cycle.start")
def start_cycle(input: CycleStartInput, context) -> ActionResult:
    before_acting()
    refuse_marked(input)
    act(context.effect_id)
    return ActionResult(ref="cycle-1")


@driver.action("label.print")
def print_label(input: LabelPrintInput, context) -> None:
    before_acting()
    refuse_marked(input)
    act(context.effect_id)


if __name__ == "__main__":
    sys.exit(driver.run())
