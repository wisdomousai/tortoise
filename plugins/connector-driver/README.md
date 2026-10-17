# @agent-native/connector-driver

Hardware drivers in any language behind the outbox. A driver is an executable that controls equipment (an instrument, a controller, a vendor COM server). The host starts it through the process port and talks to it with JSON-RPC 2.0, one message per line, over its stdio. Driver actions become outbox targets, and driver state becomes readings. The equipment's own code runs in the driver process, so a crash, a 32-bit COM server or a device permission never touches the process that holds the workspace.

Layer: plugins (`plugins/*`). `contracts` is browser-safe; everything else is server only. The plugin entrypoints (manifest, plugin, status screen, command line) come next; this package currently ships the parts an application wires in `connect`. Background and phases: [the hardware driver plan](../../docs/hardware-driver-plan.md).

## Contents

| Import                                      | Runs in            | Contents                                                                                                                                          |
| ------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/connector-driver/contracts`  | browser and server | `defineDriverContract`, `driverContractDocument` (JSON, schemas as JSON Schema), `driverComponent` (the process, device and network requirements) |
| `@agent-native/connector-driver/protocol`   | server             | The JSON-RPC connection, `DriverError` and the checked answer schemas                                                                             |
| `@agent-native/connector-driver/supervisor` | server             | `createDriverSupervisor`: handshake with digest check, restart with backoff, health checks, ordered events, shutdown                              |
| `@agent-native/connector-driver/connect`    | server             | `createDriverConnector`: a `SystemOfRecordPort` over one driver                                                                                   |
| `@agent-native/connector-driver/testing`    | server (tests)     | `createFakeDriver`: the protocol in process, with injected crashes, hangs, failures and event gaps                                                |

A contract declares state fields, actions and events. Each action has an input schema, a delivery mode, a hazard class, a timeout, and optionally a readback and preconditions on state.

- `idempotent`: the driver deduplicates by effect ID, so a retry is safe.
- `convergent`: the host reads the readback first and accepts without acting when it already holds. After acting, it accepts only once the readback holds across the fields' `stableReads`.
- `once`: the driver answers `action.lookup`, so after a lost reply the dispatcher asks before sending again.

The contract digest is the SHA-256 of `driverContractDocument`'s canonical JSON. The stub generators write it into the driver, and the handshake refuses a driver that answers with another.

## Trust boundary

A driver is deployment code the site binds by path and optional hash. Its answers are still checked: a malformed answer is a protocol error, never a value, and its stderr is drained and never shown. Its messages are capped at 500 characters before they reach application state.

The host gates every action before the driver sees it:

- monitor-only refuses everything;
- assist refuses any hazard other than `none`;
- an `operator-present` action needs `presence.confirmedBy` in its input;
- while the contract's control field shows local control, actions wait.

The mode travels with every `action.invoke`, so a driver built with the SDKs refuses too, and the mode is enforced on both sides.

An action in flight when the driver exits, times out or is cancelled fails transiently. It does not count as rejected. Its delivery mode then decides: an idempotent action is resent, a once action is looked up, and a convergent action is read back. If the readback does not show the result, the effect is held for a person. A driver's own `uncertain` answer holds the effect at once.

Gaps: no plugin entrypoints yet; no observer or remote-query source over driver state; no remote transport. The fake driver is the only driver so far; the Python and .NET SDKs follow.

## Tests

```sh
bun test plugins/connector-driver
```

- `test/conformance.test.ts` runs the shared connector conformance suite (`@agent-native/testing/connectors`) once per delivery mode against the fake driver.
- `test/driver.test.ts` covers:
  - contract validation and the digest;
  - a digest mismatch with backoff;
  - restarts with new sessions, event order and gaps;
  - exits and cancellation in flight;
  - mode refusal on both sides;
  - operator confirmation;
  - convergence without acting, local control and preconditions;
  - `uncertain` held, and a lost reply found by lookup.
