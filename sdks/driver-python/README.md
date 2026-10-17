# @agent-native/driver-sdk-python

The Python package `agent-native-driver` (module `agent_native_driver`). Write a hardware driver for an agent-native host in Python. This package depends only on the protocol that `plugins/connector-driver` defines; nothing in the host depends on it. The host starts the driver as a child process and speaks JSON-RPC 2.0 to it, one message per line, over stdin and stdout. The SDK answers the protocol; the driver author writes the handlers that touch the equipment. It needs Python 3.11 or newer and uses only the standard library, so a driver packaged with PyInstaller or Nuitka has nothing extra to bundle.

## Writing a driver

1. Write the contract file from the host application, and generate the stub from it:

   ```sh
   app driver contract chamber --out chamber.json
   python -m agent_native_driver.stubgen chamber.json -o chamber_contract.py
   ```

   The stub holds `DIGEST`, `CONTRACT` and a `TypedDict` per action input, result and event payload. The generator recomputes the digest the way the host does (canonical JSON, SHA-256) and refuses a file whose digest does not match its document.

2. Register handlers and run:

   ```python
   from agent_native_driver import ActionResult, Device, Driver, Refusal
   from chamber_contract import CONTRACT, DIGEST, SetpointSetInput

   driver = Driver(CONTRACT, DIGEST, driver_id="chamber", version="1.0.0", journal="/var/lib/chamber/journal.jsonl")

   @driver.on_initialize
   def open_chamber(configuration):
       return [Device(serial=port.serial, firmware=port.firmware)]

   @driver.on_state
   def read(fields):
       return {"setpoint": port.setpoint(), "door": port.door()}

   @driver.action("setpoint.set")
   def set_setpoint(input: SetpointSetInput, context):
       if input["setpoint"] > port.maximum:
           raise Refusal("rejected", "Out of range", "OUT_OF_RANGE")
       port.write_setpoint(input["setpoint"])

   driver.run()
   ```

   Handlers may be plain functions or coroutines. `driver.emit(name, payload)` sends a declared event and may be called from any thread, such as a serial reader.

`examples/chamber_sim.py` is a complete driver: the host's conformance tests run it.

## What the SDK enforces

- **Mode.** The host sends its bridge mode with every action:
  - `monitor-only` refuses every action;
  - `assist` refuses any hazard other than `none`;
  - an `operator-present` action needs `presence.confirmedBy`.

  The SDK checks this before the handler runs, so the driver is safe even if the host's own check failed.

- **Deadline.** An action whose deadline has passed is refused as transient without running.
- **Once per effect.** `idempotent` and `once` actions run at most once per effect ID:
  - a repeat returns the recorded outcome;
  - `action.lookup` answers from the journal;
  - `convergent` actions are not deduplicated, because the host reads the equipment back before it resends one.
- **Journal.** The journal records `started` (fsynced) before a handler runs, and the outcome after. An effect that started and has no outcome reads as `uncertain`, and the host holds it for a person. A contract with `once` actions needs `journal=`, so lookups survive a restart.
- **Failures.** A handler that raises anything other than `Refusal` reads as `uncertain`, because the driver cannot tell how far the equipment got. Raise `Refusal("transient", ...)` when you know nothing happened.
- **Events.** An event declared with `maxRateHz` is dropped above that rate before it gets a sequence number, so the host sees no gap.
- **Output.** `print` goes to stderr while the driver runs, so stdout carries only protocol messages. The host drains stderr and never shows it.

## Trust boundary

The driver trusts the host's configuration and the effect IDs it sends. Input validation against the contract's JSON Schema happens in the host before an action is sent; the SDK does not repeat it. The journal path should be private to the driver's service account.

## Tests

```sh
PYTHONPATH=sdks/driver-python/src python3 -m unittest discover -s sdks/driver-python/tests
bun test sdks/driver-python
```

The first runs the SDK's rules without a host: gating, deduplication, the journal across a restart, serving over pipes, and the stub generator. The second runs from the repository root as part of `bun run check`. It generates the stub from the base's reference contract (`chamber` in `@agent-native/connector-driver/testing`) and checks the simulated chamber with `checkDriver`. It then runs `chamberConformance`, the shared connector conformance suite, against the chamber as a real child process for each delivery mode, including a driver crash after acting. It is skipped when `python3` is not on PATH.

## Skills

- [write-hardware-driver](../../plugins/connector-driver/skills/write-hardware-driver/SKILL.md): driver contracts, SDKs and driver checks.
