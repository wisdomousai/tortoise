# @tortoise/driver-sdk-python

`tortoise-driver`: write a hardware driver in Python. The SDK speaks the driver protocol; you write the handlers that touch the equipment. The driver trusts the host's configuration and the effect IDs it sends; the host validates input against the contract's JSON Schema before it sends an action, and the SDK does not repeat that check.

## Writing a driver

Write the contract file from the host application and generate the stub from it:

```sh
app driver contract chamber --out chamber.json
python -m tortoise_driver.stubgen chamber.json -o chamber_contract.py
```

The stub holds `DIGEST`, `CONTRACT` and a `TypedDict` per action input, result and event payload. The generator recomputes the digest the way the host does (canonical JSON, SHA-256) and refuses a file whose digest does not match its document. Then register handlers and run:

```python
from tortoise_driver import ActionResult, Device, Driver, Refusal
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

Handlers are plain functions or coroutines. `driver.emit(name, payload)` sends a declared event from any thread, such as a serial reader.

- Primitives: [Driver SDK](../../docs/primitives.md#driver-sdk).

## References

- [write-hardware-driver](../../plugins/connector-driver/skills/write-hardware-driver/SKILL.md)
- [Hardware drivers](../../docs/hardware-drivers.md)
- Test: `bun test sdks/driver-python`
