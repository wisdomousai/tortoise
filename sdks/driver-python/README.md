# @agent-native/driver-sdk-python

The Python package `agent-native-driver` (module `agent_native_driver`), for writing a hardware [driver](../../docs/glossary.md#driver) for an agent-native [host](../../docs/glossary.md#host) in Python. The SDK implements the driver protocol, and the driver author writes the handlers that touch the equipment.

## Layer

[driver SDK](../../docs/glossary.md#driver-sdk) (`sdks/*`). The package depends only on the protocol that `plugins/connector-driver` defines, and nothing in the host depends on it. The host starts the driver as a child process. The host speaks JSON-RPC 2.0 to it over stdin and stdout, one message per line.

## Primitives

- [Driver SDK](../../docs/primitives.md#driver-sdk): `Driver`, `Refusal`, `Device`, `Reading`, `ActionContext`, `ActionResult`, the journal and the stub generator.

## Entrypoints

| Path | Runs in | Holds |
| --- | --- | --- |
| `src/agent_native_driver` | driver process | `Driver`, `Refusal`, `Device`, `Reading`, the journal and the line protocol. |
| `agent_native_driver.stubgen` | build time | The stub generator, also installed as the `agent-native-driver-stubgen` command. |
| `examples/chamber_sim.py` | driver process | A complete driver for a simulated chamber; the host's conformance tests run it. |
| `tests/test_driver.py` | Python | The SDK's own tests. |
| `test/host.test.ts` | Bun | The host side: the stub, the driver check and the conformance suite. |

### Writing a driver

1. Write the contract file from the host application, and generate the stub from it:

   ```sh
   app driver contract chamber --out chamber.json
   python -m agent_native_driver.stubgen chamber.json -o chamber_contract.py
   ```

   The stub holds `DIGEST`, `CONTRACT` and a `TypedDict` per action input, result and event payload. The generator recomputes the digest the way the host does (canonical JSON, SHA-256). It refuses a file whose digest does not match its document.

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

## Trust boundary

The driver trusts the host's configuration and the [effect](../../docs/glossary.md#effect) IDs it sends. The host validates input against the contract's JSON Schema before it sends an action, and the SDK does not repeat that check. The journal path should be private to the OS user the driver runs as.

The SDK enforces these rules whatever the handlers do:

- **Mode.** The host sends its [bridge mode](../../docs/glossary.md#bridge-mode) with every action, and the SDK checks it before the handler runs:
  - `monitor-only` refuses every action;
  - `assist` refuses any [risk level](../../docs/glossary.md#risk-level) other than `none`;
  - an `operator-present` action needs `presence.confirmedBy`.

- **Deadline.** An action whose deadline has passed is refused as transient without running.
- **Once per effect.** Actions with the `idempotent` or `once` [delivery mode](../../docs/glossary.md#delivery-mode) run at most once per effect ID:
  - a repeat returns the recorded outcome;
  - `action.lookup` returns the journal's record;
  - `convergent` actions are not deduplicated, because the host reads the equipment back before it resends one.
- **Journal.** The journal records `started` and fsyncs it before a handler runs, then records the outcome. An effect that started and has no outcome reads as `uncertain`, and the host holds it for a person.
- **Journal file.** A contract with `once` actions needs `journal=`, so lookups survive a restart.
- **Failures.** A handler that raises anything other than `Refusal` reads as `uncertain`, because the driver cannot tell how far the equipment got. Raise `Refusal("transient", ...)` when you know nothing happened.
- **Events.** An event declared with `maxRateHz` is dropped above that rate before it gets a sequence number, so the host sees no gap.
- **Output.** `print` goes to stderr while the driver runs, and stdout carries only protocol messages. The host drains stderr and never shows it.

## Dependencies

Python 3.11 or newer and the standard library only. A driver packaged with PyInstaller or Nuitka therefore has nothing extra to bundle. The host test imports `@agent-native/connector-driver`.

## Tests

```sh
PYTHONPATH=sdks/driver-python/src python3 -m unittest discover -s sdks/driver-python/tests
bun test sdks/driver-python
```

- `tests/test_driver.py`: the SDK's rules without a host: gating, deduplication, the journal across a restart, serving over pipes, and the stub generator.
- `test/host.test.ts`: generates the stub from the reference contract (`chamber` in `@agent-native/connector-driver/testing`) and checks the simulated chamber with `checkDriver`. It then runs `chamberConformance`, the shared connector conformance suite, against the chamber as a real child process for each delivery mode, including a driver crash after acting.

The host test runs from the repository root as part of `bun run check`. It is skipped when `python3` is not on PATH.

## Skills

- [write-hardware-driver](../../plugins/connector-driver/skills/write-hardware-driver/SKILL.md): driver contracts, SDKs and driver checks.

## References

- [Hardware drivers](../../docs/hardware-drivers.md)
