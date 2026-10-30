# Hardware drivers

A driver is a separate process, in any language, that connects your application to an instrument, a controller or a workstation application. Its actions are outbox effects and its state enters as observations, so capabilities, screens and agents treat it like any other [system of record](systems-of-record.md).

## Try it

From the repo root:

```sh
AGENT_NATIVE_APPLICATION=@agent-native/winding-line bun run --silent cli driver list
```

You should see:

```text
station-automation 1.0.0  Station automation
  process  station-automation-driver (optional)
  digest   8d0cc0aadd5a5c638154bb2bbbef45c715c65a7c254202c5cdaa0b6ed271ddf9
  action   recipe.load  convergent, risk operator-present
```

Then run the drivers end to end against simulated equipment:

```sh
bun test plugins/connector-driver sdks/driver-python sdks/driver-dotnet
```

The .NET suite skips itself without `dotnet` on `PATH`; the Python suite needs `python3`.

## Write a driver

1. Write the contract in the application with `defineDriverContract`, and wire the driver and process plugins ([connector-driver README](../plugins/connector-driver/README.md#wiring-an-application)).
2. Export the contract and generate stubs. For Python:

   ```sh
   app driver contract <id> --out <id>.json
   python -m agent_native_driver.stubgen <id>.json -o <id>_contract.py
   ```

3. Write the driver with the [Python](../sdks/driver-python/README.md) or [.NET](../sdks/driver-dotnet/README.md) SDK: a handshake handler that opens the equipment, a state reader, and one handler per action.
4. Check it against the contract. This never sends `action.invoke`, so it is safe on live equipment:

   ```sh
   app driver check <id> -- <absolute executable>
   ```

5. Build one self-contained executable (PyInstaller, Nuitka, or a .NET single-file build; `win-x86` for a 32-bit COM server).
6. Bind its path and hash in the deployment policy ([Process binding](#process-binding)). `app driver list` prints the process ID and digest to bind.

In a checkout, `app driver` is `bun run --silent cli driver` with `AGENT_NATIVE_APPLICATION` set. The [write-hardware-driver](../plugins/connector-driver/skills/write-hardware-driver/SKILL.md) skill covers these steps for Claude Code or Codex.

## Why a separate process

Vendor code never runs in the host: no FFI, native addons or in-process COM. A vendor crash would kill the process holding the workspace, COM needs its own apartment, a 32-bit COM server can't load into a 64-bit host, and devices often need another OS user.

## Process binding

The driver plugin's manifest declares each driver process as a requirement. The [deployment policy](security-and-compliance.md#deployment-policy) binds it to an absolute executable with fixed arguments and environment, and optionally its hash.

- The child gets no inherited environment, no `PATH` and no `PYTHONPATH`; give it absolute paths in the binding's environment.
- Closing the driver kills its whole process tree.
- A required driver with no binding stops startup; an optional one stays unavailable.

## Driver contract

`defineDriverContract` declares:

- state fields: type, unit, decimals, minimum confidence, and how many agreeing reads make a value stable;
- actions: input schema, [delivery mode](#delivery-modes), risk level, timeout, optional preconditions and readback;
- events: kind (telemetry, occurrence, progress) and maximum rate;
- the `control` field that shows local operation;
- whether the driver supports lookups;
- the process, with its devices and network destinations.

The digest is the SHA-256 of the contract's canonical JSON. Stub generators write it into the driver, and the handshake refuses a driver with a different digest.

### Delivery modes

| Mode | Safe resend because | After a lost reply |
| --- | --- | --- |
| `idempotent` | The driver deduplicates by effect ID. | Resend. |
| `convergent` | The host checks the readback first and skips the action if it already holds. Needs a readback. | Read back: accept if it holds, otherwise [hold](systems-of-record.md#held-effects) unless the action surely never ran. |
| `once` | The driver journals each effect before acting. Needs lookup. | Ask with `action.lookup`; a started effect with no outcome returns `uncertain`, and the dispatcher holds it. |

Reconciling a held convergent effect as not applied lets the next delivery act again.

## Protocol

JSON-RPC 2.0, one message per line on stdin and stdout. The host drops lines over 1,048,576 characters as malformed, and drains stderr without showing it.

| Method | From | Purpose |
| --- | --- | --- |
| `initialize` | host | Check protocol and contract digest; driver returns session ID and units (serial, firmware, model). |
| `state.read` | host | Read fields, with optional confidence. |
| `action.invoke` | host | Run an action with effect ID, deadline and bridge mode. |
| `action.lookup` | host | Ask what happened to an effect. |
| `$/cancel` | host | Cancel a request. |
| `event` | driver | Notification with session and sequence number. A new session ID means a restart. |
| `health` | host | Liveness; a failure stops the driver. |
| `shutdown` | host | Orderly stop before the host kills the process tree. |

### Failure kinds

| Kind | Meaning | Effect outcome |
| --- | --- | --- |
| `rejected` | Equipment refused for good. | Business rejection with the driver's code. |
| `precondition` | Not in a state to do it now. | Business rejection. |
| `transient` (default) | Nothing done. | The dispatcher retries with backoff. |
| `uncertain` | May have acted. | The dispatcher holds it for a person. |
| `refused` | Bridge mode or driver rules forbid it. | Waits until the mode allows it. |

A crash, timeout, cancel or malformed reply mid-action is transient; the delivery mode decides what happens before the resend.

## Interlock

Driver actions pass the same interlock as [screen procedures](operator-workstations.md#interlock). For each effect the connector:

1. rejects an unknown action, invalid input, or an `operator-present` action without presence confirmation;
2. waits unless the bridge mode allows the risk level (`monitor-only` none, `assist` only `none`, `actuate` all);
3. accepts without acting if the readback already holds;
4. waits while `control` shows local operation;
5. rejects on unmet preconditions and waits on unreadable ones.

The application's control query supplies the mode and may refuse for its own reasons; `winding-line` refuses while the operator holds control. Drivers start in `monitor-only`, and the SDKs re-check mode, presence, deadline and once-per-effect inside the driver. A handler exception other than a refusal reads as `uncertain`.

## Timing

The framework is not real-time. Keep loops under a second, motion and closed-loop control in the driver or controller; to the framework they are one action. Every committed observation is a command, so the observer submits values only once stable and repeats unchanged ones once per heartbeat. SDKs drop events above the declared rate before numbering them. Send high-rate data to a historian.

## Examples

- **Measuring instrument** (`showcase/examples/quality-inspection`): a Python driver reads a gauge over serial; no actions. Each stable reading becomes an instrument reading; the inspector clicks **Use reading**. Tests run the real serial code over a pseudo-terminal pair.
- **Station automation** (`showcase/examples/winding-line`): a .NET driver loads recipes through the vendor COM server as a convergent `operator-present` action, the same domain as the [screen route](operator-workstations.md#automation-route). A simulated station replaces COM in tests and the demo.

## Limits

- Drivers never operate safety functions; nothing here is safety-rated.
- The proxy confines only HTTP and HTTPS. Only the exported OS rules confine raw sockets (Modbus TCP, OPC UA).
- A driver that declares secrets needs a platform secret store; the Bun platform has none.
- The policy pins executables by hash; nothing signs them, and site bundles leave them out.
- Not built: remote drivers over mTLS, a non-journaled fast reading stream, remote queries over driver state, Android in-process drivers, a C++ SDK.

## See also

[Operator workstations](operator-workstations.md) · [Security and compliance](security-and-compliance.md) · [Process plugin](../plugins/process/README.md)
