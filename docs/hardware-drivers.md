# Hardware drivers

A hardware driver runs as a separate process implementing the connector-driver protocol. The host invokes only the actions declared in its contract. Driver state enters the application as observations, and application commands request actions through outbox effects.

The process boundary keeps vendor libraries outside the host process that owns the workspace. It also permits a driver to use the runtime and architecture required by its vendor interface. The host supervises the driver and validates its protocol responses.

## Write a driver

Declare the driver with `defineDriverContract` in the application and compose the driver and process plugins. The contract must describe the action interface the application will deliver and the fields it can observe. The [driver skill](../plugins/connector-driver/skills/write-hardware-driver/SKILL.md) describes this composition.

Export its contract through the application CLI. The Python SDK can generate its contract declarations:

```sh
app driver contract <id> --out <id>.json
python -m tortoise_driver.stubgen <id>.json -o <id>_contract.py
```

Implement protocol initialization and the declared state reads in the driver. Each declared action needs its own handler. The [Python SDK](../sdks/driver-python/README.md) and [.NET SDK](../sdks/driver-dotnet/README.md) supply protocol handling and contract checks.

`app driver check <id> -- <absolute-executable>` checks the process against its contract without sending `action.invoke`. Initialization can still open equipment and execute driver startup code, so inspect that behavior before running the check on connected equipment.

Build an executable for the machine that supplies the vendor interface, then bind its path in the deployment policy. `app driver list` prints the declared process identifier and contract digest. In the repository, `app` means `bun run --silent cli` with the selected application configured.

## Why a separate process

Vendor code runs in the driver process. A driver crash therefore does not directly terminate the host that owns the workspace. The process can satisfy a vendor runtime's bitness or apartment requirements independently of the Bun host. Process supervision still needs to recover an interrupted action according to the contract's delivery mode.

## Process binding

The driver manifest declares a process requirement. The deployment policy binds that identifier to an absolute executable and its fixed arguments. A configured digest pins the executable bytes. The child receives the declared environment without inherited `PATH` or `PYTHONPATH`, so required paths must be explicit.

An unbound required driver prevents startup. An optional unbound driver remains unavailable. Closing a driver terminates its process tree. The [process plugin](../plugins/process/README.md) specifies launch and supervision.

## Driver contract

`defineDriverContract` declares each state field's type and presentation metadata. It can specify confidence and stable-read requirements. Each action declares its input schema and delivery mode, including the risk level and timeout. Preconditions and readback refer to declared state fields.

The contract also declares its event kinds and maximum event rate. A configured `control` field identifies local equipment operation. Lookup support is required for delivery modes that need it. Process requirements identify the driver's device access and external destinations.

The contract digest is SHA-256 over its canonical JSON. Stub generation embeds this digest in the driver. Initialization rejects a different digest, preventing a process built for another contract from serving the declared actions.

### Delivery modes

| Mode | Contract requirement | Recovery after a lost reply |
| --- | --- | --- |
| `idempotent` | The driver deduplicates by effect ID | The connector can resend |
| `convergent` | A readback identifies the intended state | Accept if the readback matches; otherwise hold an uncertain attempted action |
| `once` | The driver journals effect IDs and supports lookup | Ask `action.lookup`; a started effect without outcome returns uncertainty |

Convergent recovery can send again when the connector knows no action occurred. A held effect reconciled as `not applied` is released for another attempt. A readback disagreement alone does not establish that the interrupted action never happened.

## Protocol

The protocol is JSON-RPC 2.0 with a message per line on stdin and stdout. The host rejects lines longer than 1,048,576 characters as malformed. It drains stderr without exposing it through application results.

| Method | Sender | Contract |
| --- | --- | --- |
| `initialize` | Host | Check protocol version and digest; receive driver session and unit metadata |
| `state.read` | Host | Read declared fields and any confidence values |
| `action.invoke` | Host | Invoke a declared action with effect ID, deadline and bridge mode |
| `action.lookup` | Host | Recover an effect's action outcome |
| `$/cancel` | Host | Cancel an outstanding request |
| `event` | Driver | Report a sequenced event within the driver session |
| `health` | Host | Check liveness |
| `shutdown` | Host | Request orderly termination |

A new session identifier marks a driver restart. A failed health check stops the process; the supervisor applies its restart behavior.

### Failure kinds

| Kind | Driver classification | Delivery behavior |
| --- | --- | --- |
| `rejected` | Permanent equipment refusal | Complete with the driver's rejection code |
| `precondition` | Required state is unmet | Complete with `PRECONDITION` |
| `transient` | The action did not execute | Retry according to dispatcher backoff |
| `uncertain` | The action may have executed | Hold for reconciliation |
| `refused` | Driver mode or action rules prevent execution | Defer until permitted |

A crash or timeout can interrupt a request after it reached the driver. The supervisor reports a transient transport failure; before resending, the connector applies the action's lookup or readback recovery. SDK handlers must classify uncertain execution correctly. An unclassified action-handler exception is reported as uncertain by the SDK.

## Action checks

The connector rejects an unknown action and invalid payload before reading equipment state. An `operator-present` action requires the declared presence confirmation. The bridge mode must permit the action's risk level; a blocked mode defers delivery.

A matching readback accepts the effect without acting. Otherwise local equipment control defers it. Unmet preconditions reject the effect, while unreadable preconditions defer execution. After invocation, a declared readback must match across its stable-read requirement before the connector accepts the effect.

Drivers begin in `monitor-only`. The application supplies the control query that permits a different mode. SDK checks also enforce action risk and presence inside the driver, including the deadline and once-per-effect rules. The shared mode vocabulary is specified in [Operator workstations](operator-workstations.md#bridge-modes-and-risk-levels).

## Timing

Real-time loops belong in the driver or controller. The framework executes transactional commands and cannot provide deterministic control-loop timing. An observer submits a reading when it becomes stable and can repeat unchanged values at its configured heartbeat. Event-rate limits drop excess events before sequence numbers are assigned. High-rate telemetry needs storage suited to that stream.

## Checks

From the repository root:

```sh
bun test plugins/connector-driver sdks/driver-python sdks/driver-dotnet
```

The Python checks require `python3`; .NET checks skip when `dotnet` is unavailable. These suites use simulated equipment and protocol fixtures. They do not establish hardware behavior for an installation.

## Limits

Drivers must not operate safety functions. The framework is not safety-rated. Its process proxy governs HTTP and HTTPS proxy traffic; raw sockets require separately applied OS enforcement. A driver declaring secrets requires a platform secret store, which the Bun platform does not currently supply.

Executables can be pinned by hash, but driver signing and distribution are not implemented. Remote mTLS drivers are unsupported. The current interface provides no non-journaled fast reading stream or remote query over driver state. Android in-process drivers and a C++ SDK are also unimplemented. Dated execution evidence belongs in [Implementation status](implementation-status.md#hardware-drivers).
