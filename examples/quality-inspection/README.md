# @agent-native/quality-inspection

`quality-inspection` captures quality inspection results on top of an external quality system, which is the [system of record](../../docs/glossary.md#system-of-record). The system of record owns inspection lots, specifications and code catalogs, which arrive through the integration principal's sync command. This application owns what is recorded at the moment of inspection: results, defects and usage decisions, each forwarded to the system of record through the [outbox](../../docs/glossary.md#outbox).

Records are append-only, and a correction supersedes a result instead of editing it. Inspectors, supervisors and viewers hold roles per plant.

## Layer

Content (`examples/*`). The demo quality system ([`fake-sor.ts`](fake-sor.ts)) lives here, and only this application's `connect` wires it.

## Primitives

The example is one [application](../../docs/primitives.md#application). It composes:

- a [module](../../docs/primitives.md#module) of `inspection.*` [capabilities](../../docs/primitives.md#capability), plus the `compliance` module from its plugin.
- the `site`, `network`, `audit`, `compliance`, `process` and `driver` (`connector-driver`) [host plugins](../../docs/primitives.md#host-plugin). The screens compose the compliance and driver plugins' screens.
- a [driver contract](../../docs/primitives.md#driver-contract) for the capture station's measuring instrument (`contracts/instrument.ts`), and a Python [driver process](../../docs/primitives.md#driver-process) for it in `drivers/instrument/`.
- [outbox effects](../../docs/primitives.md#outbox-effect) for every captured record, delivered by a [dispatcher](../../docs/primitives.md#dispatcher) through a [connector](../../docs/primitives.md#connector). [Inbound sync](../../docs/primitives.md#inbound-sync) brings in lots and code groups. One [target](../../docs/primitives.md#target) in `contracts/target.ts` declares both directions.
- [capability bindings](../../docs/primitives.md#capability-binding) for keyboard-first capture: `useCapabilityForm`, capture timing and wedge-scan routing.
- the frame's [UI registry](../../docs/primitives.md#ui-registry) parts `live-data-table` and the operator-ui parts `tile-picker`, `numeric-pad` and `status-strip`. The Compliance screen comes from the compliance plugin.

`bun run generate` writes the capability reference to `dist/reference/quality-inspection/operations.md`.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/quality-inspection/manifest` | browser and server | Default export: `defineManifest` with ID `quality-inspection`. |
| `@agent-native/quality-inspection/application` | server only | Default export: `defineApplication`, whose `connect` wires the quality-system target and the instrument's readings. |
| `@agent-native/quality-inspection/screens` | browser | Default export: `defineScreens` with Inspection, Capture, Synchronization, the sync badge and the plugin screens. |
| `@agent-native/quality-inspection/*` | see file | Other modules by name: `contracts` (browser-safe), `domain`, `policy`, `server`, `fake-sor`. |

`appendResult` in `server/` validates a measurement, picks the sample and queues forwarding, all in the caller's transaction.

Hooks that issue commands, such as `useCapture` and the defect and correction forms, are `.tsx`, because the UI-binding test only reads screen files.

### Commands

| Command (in this directory) | Purpose |
| --- | --- |
| `bun run dev` | Desktop window on port 4322 with the demo quality system. |
| `bun run dev:web` | Browser on port 4322 with the demo quality system. |

These variables change the demo quality system:

- `DEMO_QUALITY_LOCKED_LOTS=<lot>,<lot>` makes it reject forwarded records for those lots, as if another person held a lock.
- `DEMO_QUALITY_UNAVAILABLE=1` makes every delivery fail transiently.

Resolve both under **Synchronization**. The framework never reads these variables.

### Measuring instrument

The capture station can read a gauge or balance through its serial data output. The instrument only reports, and its contract has no actions. The inspector presses the instrument's data button, and the capture station offers the reading above the value field.

A reading is not a result until a person confirms it. The instrument does not know the part or characteristic it measured. The instance refuses a confirmation when:

- the reading was already used;
- it is older than 10 minutes;
- it is in another unit than the characteristic;
- its value or time differs from the reading on screen.

The driver is optional. Without a deployment policy binding for the `instrument-driver` process, nothing starts and the capture station looks as before. To run it, install the SDK (`sdks/driver-python`) and `pyserial` into a Python environment. Then bind the process in the deployment policy:

```json
{
  "processes": {
    "instrument-driver": {
      "executable": "/opt/instrument/venv/bin/python",
      "args": ["/opt/instrument/instrument_driver.py"],
      "env": { "INSTRUMENT_PORT": "/dev/ttyUSB0", "INSTRUMENT_ID": "GAUGE-0042" }
    }
  }
}
```

`instrument_contract.py` is generated from `contracts/instrument.ts` with the SDK's stub generator, and a test fails when the two differ. `simulator.py` puts a simulated instrument on a pseudo-terminal pair for tests and demos.

## Trust boundary

Plant roles come from state. Handlers scope lots and results to the caller's plants before filtering, counting and pagination.

The quality-system integration runs as its own principal (`INTEGRATION_PRINCIPAL`), whose grant can sync and settle but cannot capture. The instrument driver runs as another principal (`INSTRUMENT_PRINCIPAL`), which can only report readings. Readings are visible to people who capture at some plant.

A commit [receipt](../../docs/glossary.md#receipt) proves the local write only. The sync badge and the Synchronization screen show whether the system of record has accepted it. Capture telemetry does not influence authorization.

## Dependencies

Framework and plugins: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/integration`, `@agent-native/frame`, `@agent-native/react`, `@agent-native/site`, `@agent-native/network`, `@agent-native/audit`, `@agent-native/compliance`, `@agent-native/process` and `@agent-native/connector-driver`. The tests also use `@agent-native/testing`, `@agent-native/adapters`, `@agent-native/client` and `@agent-native/event-log`.

External: `zod`, `react`, `@tanstack/react-query`, `@tanstack/react-router` and `lucide-react`. The instrument driver needs Python 3.11 or newer and `pyserial`. Content must never import `apps/*`.

## Tests

```sh
bun test examples/quality-inspection
bun run test:sandbox
bunx playwright test examples/quality-inspection/e2e
```

- `domain.test.ts`:
  - watermarked inbound sync;
  - plant-scoped lists and events;
  - one datapoint per idempotency key;
  - all-or-nothing batches;
  - role rules;
  - system-of-record outcomes and corrections;
  - outage behavior;
  - metrics.
- `test/conformance.test.ts`: a datapoint captured over any surface commits once, is forwarded once and settles live.
- `test/application.test.ts`: the embedded instance syncs and drains the target it declares.
- `test/sandbox.test.ts`: the compiled binary with an empty environment runs embedded MCP capture under a grant, returns drain exit codes and runs a grant-bound `serve`.
- `test/security.test.ts`: auditors read posture over HTTP, and the CLI verifies, reports and detects tampering.
- `test/ui-bindings.test.ts`: every capability that claims a UI binding is referenced by a screen.
- `test/instrument.test.ts`, with the in-process fake driver:
  - an event becomes a reading, an inspector confirms it once, and the forwarded record names the instrument;
  - only the instrument principal reports readings;
  - stale, reused, mismatched and other-unit confirmations are refused;
  - replays record once.
- `test/instrument-driver.test.ts`, the Python driver over a pseudo-terminal pair with its real serial code:
  - the committed stub matches the contract;
  - `checkDriver` passes;
  - a stable line becomes a confirmed result;
  - an unplugged port fails the health check;
  - the test needs `python3` and `pyserial`, installed or in uv's cache, and is skipped otherwise.
- `e2e/inspection.pw.ts`, in Chromium: keyboard-only capture, wedge bursts and double Enter record once, live system-of-record outcomes, and drafts keep their sample.
- `e2e/compliance.pw.ts`: the Compliance screen shows a new denial without a reload.
- `e2e/instrument.pw.ts`, in Chromium with the real host, a deployment policy binding the Python driver and a pseudo-terminal instrument: a key press on the instrument is offered on the capture station and recorded with **Use reading**. It is skipped without uv and a cached `pyserial`.

## Demonstrated mechanisms

Paths under the packages and scripts directories are relative to the repository root. The others are relative to `examples/quality-inspection`.

| Mechanism | Code | Proof |
| --- | --- | --- |
| [Module](../../docs/primitives.md#module) | `contracts.ts` `qualityInspectionModule` | `test/conformance.test.ts` |
| [Capability](../../docs/primitives.md#capability) with a description and a UI binding or exception | `contracts/operation.ts` `operation` | `test/ui-bindings.test.ts` |
| [Collection](../../docs/primitives.md#collection) of lots per plant, scoped before counting | `contracts/collections.ts` `lots`; `handlers/lots.ts` | `domain.test.ts`, "plant roles scope lists, reads and events before counting" |
| [Membership](../../docs/primitives.md#membership) of plant roles | `contracts/membership.ts` `plantMembership`; `handlers/supervision.ts` | `domain.test.ts`, "the integration principal cannot capture and operators cannot settle"; `e2e/inspection.pw.ts` |
| [Policy](../../docs/primitives.md#policy) per lot, plant role and resource grant | `policy.ts` `qualityPolicy` | `domain.test.ts`, "roles govern capture, correction and the usage decision" |
| Revision precondition on the usage decision | `handlers/supervision.ts`; `ui/capture/decision-panel.tsx` | `domain.test.ts`, "roles govern capture, correction and the usage decision" |
| [Target](../../docs/primitives.md#target) with settle, sync and status capabilities | `contracts/target.ts` `qualityTarget`; `handlers/integration.ts` | `domain.test.ts`, "inbound sync applies SoR master data under an ordered watermark" |
| [Outbox effect](../../docs/primitives.md#outbox-effect) per result, defect and decision | `server/append-result.ts` `forward`; `handlers/capture.ts`; `handlers/supervision.ts` | `domain.test.ts`, "a batch commits all measurements or none", "SoR outcomes return as live business data, and corrections resolve rejections" and "roles govern capture, correction and the usage decision" |
| [Dispatcher](../../docs/primitives.md#dispatcher) with outcomes settled as data | `application.ts` `connectTarget`; `handlers/integration.ts` `settleDelivery` | `domain.test.ts`, "SoR outcomes return as live business data, and corrections resolve rejections" |
| [Worker claims](../../docs/primitives.md#worker-claims) with fenced settlement and a first-claim recheck | `packages/integration/src/target.ts` `connectTarget`; `packages/integration/src/dispatcher/delivery.ts` | `test/conformance.test.ts`, "a datapoint captured over any transport commits once, is forwarded once and settles live"; `packages/integration/test/reliability.test.ts`, "a worker that paused past its lease cannot overwrite the worker after it" and "the original actor is authorized again before the first delivery" |
| Transient delivery failure and retry with backoff | `packages/integration/src/dispatcher.ts`; `fake-sor.ts` `faults.unavailable` switches the failure on in tests | `domain.test.ts`, "an unavailable SoR leaves captured data committed and visibly retrying" |
| [Inbound sync](../../docs/primitives.md#inbound-sync) under a watermark | `handlers/integration.ts` `applyBatch`; `fake-sor.ts` `toSyncInput` | `domain.test.ts`, "inbound sync applies SoR master data under an ordered watermark" |
| [Connector](../../docs/primitives.md#connector) as an in-memory quality system | `fake-sor.ts` `FakeQualitySystem` | `test/application.test.ts` |
| Integration principal limited to the target's capabilities | `policy.ts` `targetLane`; `application.ts` `INTEGRATION_PRINCIPAL` | `domain.test.ts`, "the integration principal cannot capture and operators cannot settle"; `e2e/compliance.pw.ts` |
| Idempotency key kept across retries and surfaces | `ui/capture-station/use-capture.tsx` `useCapabilityForm` | `domain.test.ts`, "a scanner double-send with one idempotency key records one datapoint"; `test/conformance.test.ts` |
| [Surface adapters](../../docs/primitives.md#surface-adapter) for HTTP, CLI and MCP | `packages/adapters` | `test/conformance.test.ts` |
| [Embedded mode](../../docs/systems-of-record.md#topologies) with a grant file and drain | `scripts/build-cli.ts`; `scripts/application-entry.ts` | `test/sandbox.test.ts` |
| [Journal and live query](../../docs/primitives.md#journal-and-live-query) | `dependencies` in `contracts/*.ts`; `live.liveQueryOptions` in `ui/` | `domain.test.ts`, "plant roles scope lists, reads and events before counting"; `e2e/inspection.pw.ts` |
| [Capability binding](../../docs/primitives.md#capability-binding) for keyboard and wedge-scanner capture with timing | `ui/capture-station/use-capture.tsx`; `ui/inspection.tsx` | `e2e/inspection.pw.ts` |
| Capture metrics split between people and agents | `handlers/reports.ts`; `server/append-result.ts` | `domain.test.ts`, "capture metrics split human and agent time-to-commit and SoR acceptance latency" |
| [UI registry](../../docs/primitives.md#ui-registry) parts | `live-data-table` in `ui/inspection.tsx`; `tile-picker`, `numeric-pad` and `status-strip` in `ui/` | `e2e/inspection.pw.ts` |
| [UI session context](../../docs/primitives.md#ui-session-context) selection of a lot | `application.ts` `selectableResources` | No test in this example |
| [Driver contract](../../docs/primitives.md#driver-contract) with events and no actions | `contracts/instrument.ts` `instrumentContract` | `test/instrument-driver.test.ts`, "the committed stub is the one generated from the contract" |
| [Driver process](../../docs/primitives.md#driver-process) started through the [process port](../../docs/primitives.md#process-port) | `application.ts` `instrumentDriverPlugin` and `connect` | `e2e/instrument.pw.ts` |
| [Observation](../../docs/primitives.md#observation) through an ingest command | `application.ts` `createInstrumentIngest`; `handlers/instrument.ts` | `test/instrument.test.ts` |
| [Driver SDK](../../docs/primitives.md#driver-sdk) in Python | `drivers/instrument/instrument_driver.py` | `test/instrument-driver.test.ts`; `drivers/instrument/test_instrument_driver.py` |
| [Host plugins](../../docs/primitives.md#host-plugin) for site, network, audit and compliance | `manifest.ts`; `application.ts` | `test/security.test.ts`; `e2e/compliance.pw.ts` |
| [Requirement declaration](../../docs/primitives.md#requirement-declaration) for the target and the driver | `contracts.ts`; `contracts/instrument.ts` | `test/security.test.ts` |
| [Deployment policy](../../docs/primitives.md#deployment-policy) and [egress guard](../../docs/primitives.md#egress-guard) export | `site-policy.sandbox.json` | `test/security.test.ts` |
| [Audit log](../../docs/primitives.md#audit-log) and [compliance bundle](../../docs/primitives.md#compliance-bundle) | The audit and compliance plugins | `test/security.test.ts`; `test/sandbox.test.ts` |
| [State migration](../../docs/primitives.md#state-migration) without numbered versions | `application.ts` `upgradeState` | `test/instrument.test.ts`, "state saved before readings existed is upgraded with an empty set" |

## Structure

| Path | Holds |
| --- | --- |
| `manifest.ts` | The browser-safe manifest: the module and the plugin manifests, including the driver plugin with the instrument contract. |
| `application.ts` | The application definition: state, handlers, composed policy, plugins, `connect` and the fake quality system configured from environment variables. |
| `screens.tsx` | Routes, navigation, capability screens, the sync badge and the compliance and driver plugin screens. |
| `contracts.ts` | The module: all capabilities, the network requirement for the quality system and the agent workflows. |
| `contracts/` | Browser-safe schemas, the `operation` helper and its descriptions, queries, commands, the lot collection, plant membership, the target and the driver contract. |
| `domain.ts` | State types, plant roles, evaluation against specification limits, progress and the next open `sample` to measure. |
| `policy.ts` | `qualityPolicy`, and the mapping from a journal or outbox resource to its lot and plant. |
| `server.ts`, `server/` | The handler list and the code the handler groups share, including `appendResult`. |
| `handlers/` | The handler groups, one file each. |
| `fake-sor.ts` | `FakeQualitySystem`, the seed data and `toSyncInput`, used only by `application.ts` and the tests. |
| `ui/` | The screens and their parts. |
| `drivers/instrument/` | The Python driver, its generated contract stub, a pseudo-terminal instrument simulator and Python unit tests. |
| `site-policy.sandbox.json` | A deployment policy under the `sandbox` hardening profile, read by the security test. |
| `domain.test.ts`, `test/` | Bun tests, and the shared instrument fixture in `test/instrument-fixture.ts`. |
| `e2e/` | Playwright specs against a host started by `tests/e2e/service.ts` in the repository root. |

## Capture flow

1. The capture station binds `inspection.result.record` with `useCapabilityForm` in `ui/capture-station/use-capture.tsx`. The form validates against the contract schema and keeps one idempotency key until the command commits.
2. The form input carries the lot, characteristic, `sample` number, value or code, and `occurredAt` set to the time the person confirmed. It also carries capture timing from `useCaptureLoop` and the input kind from `useScannerInput`.
3. The policy in `policy.ts` resolves the lot's plant and requires the inspector or supervisor role there. When the caller's grant lists resources, the policy also requires it to name `lot:<id>`.
4. The handler in `handlers/capture.ts` loads the lot and refuses a lot that is not open. It then calls `appendResult` in `server/append-result.ts`.
5. `appendResult` checks the characteristic, the decimal places or the code group, and that `occurredAt` is at most 24 hours old and at most 5 minutes ahead. It picks the requested or first open `sample` and evaluates the value against the limits.
6. `appendResult` calls `ctx.enqueue` with target `quality-system`, type `result.post`, resource `result:<id>` and a payload. It stores the effect ID on the result with `sync: 'pending'`, and marks the result and its lot changed.
7. The commit writes state, revisions, the receipt, journal entries and the effect together. The receipt returns the result with `sync: 'pending'` and the effect ID, and proves the local commit only.
8. The dispatcher that `connectTarget` builds in `application.ts` claims the effect after the commit and receives a fencing token. At the first claim the runtime checks again that the recording principal may still run the command.
9. The dispatcher delivers the effect through the port. `FakeQualitySystem.deliver` accepts with a `QM-` reference, rejects with `LOT_LOCKED` or `LOT_CLOSED`, or throws `DeliveryFailure`.
10. A transient failure is recorded as an attempt and retried after a backoff. An outcome is submitted as `inspection.effect.settle` under the integration principal, with the fencing token.
11. The settle handler from `targetHandlers` checks that the effect belongs to the target. `settleDelivery` then writes `sync`, `sorRef` or `rejection` on the record that carries that effect ID.
12. The live queries for the lot, the sync badge and the Needs attention screen refetch.
13. A rejected result is resolved with `inspection.result.correct`, which appends a superseding result. The correction enqueues a `result.correct` effect with the reason, and with the original's reference when the quality system gave one.

Defects follow the same path with the effect type `defect.post`. A usage decision needs every required result recorded, and its effect type is `decision.post`.

## Master data flow

1. The inbound sync built by `connectTarget` reads the stored watermark through `inspection.sync.status` and calls `pull` on the port.
2. `toSyncInput` in `fake-sor.ts` splits the pulled items into lot snapshots and code groups, with the `from` and `to` watermarks.
3. The inbound sync submits `inspection.lot.sync` under the integration principal. The sync handler from `targetHandlers` refuses a batch whose `from` differs from the stored watermark with a conflict.
4. `applyBatch` in `handlers/integration.ts` stores each lot, and a new plant starts with no members. An existing lot keeps its local status and usage decision, and a snapshot marked closed closes an open lot.
5. The handler stores the code groups, advances the watermark and records the sync time.

## Instrument reading flow

1. The process plugin starts `instrument-driver` only when the deployment policy binds it. The `observe` hook of `connect` in `application.ts` checks the binding with `processes.availability` and starts nothing without it.
2. `instrument_driver.py` reads lines from the serial port and sends a `measurement.taken` event for each measurement, which the inspector triggers with the instrument's data button.
3. The ingest from `createInstrumentIngest` in `application.ts` runs `inspection.instrument.ingest` as the instrument principal (`INSTRUMENT_PRINCIPAL`). The reading carries the driver's identity and the instrument's ID as reported at the handshake. Its idempotency key `driver:<contract id>:<session>:<seq>` makes a replayed event record once.
4. The ingest handler in `handlers/instrument.ts` stores the instrument reading.
5. `InstrumentReadingOffer` in `ui/capture-station/instrument-reading.tsx` follows `inspection.instrument.readings` and offers the newest instrument reading.
6. The Use reading button sends `inspection.result.record` with `instrumentReading`. The handler checks the instrument reading with `confirmReading` in `handlers/instrument.ts`.
7. `appendResult` records the result with the instrument reading's provenance, so the forwarded record names the instrument, and `useReading` marks the instrument reading used.

## Implementation steps

Steps that cite a file of an existing example give its path from the framework repository root. A bare file name such as `contracts.ts` is a file of the application being built.

### Setup

1. Create the application by exporting this example or by generating one with a single collection.

   ```sh
   bun run scaffold <absent-target-directory> --name <app-name> --example quality-inspection
   bun run scaffold new <absent-target-directory> --name <app-name> --collection <record-type>
   ```

2. Install the dependencies in the new checkout, where every later command runs. An export made with `--published` or `--registry` has no lockfile yet, so drop the flag there.

   ```sh
   bun install --frozen-lockfile
   ```

3. In a generated application, start the target and each capture command with the scaffold, then format and regenerate.

   ```sh
   bun run scaffold add target <system-name> --collection <record-type>
   bun run scaffold add capability <operation-id> --kind command --description "<text>"
   bun run format && bun run generate
   ```

4. Read what the target command wrote, because later steps adapt it instead of adding it again:
   - the files `contracts/<system-name>-target.ts`, `handlers/<system-name>-target.ts`, `<system-name>-port.ts`, `ui/<system-name>-target.tsx` and `test/<system-name>-target.test.ts`;
   - the target's capabilities and a network requirement with `offline: 'queue'` in `contracts.ts`;
   - `targetLane` and `targetRules` in `policy.ts`, and handlers built with `targetHandlers` in `server.ts`;
   - `connectTarget` with the fake port in `application.ts`, and a route in `screens.tsx`;
   - a disabled `<system-name>-api` destination in `apps/desktop/site-policy.json`;
   - a `<system-name>.send` command that forwards one record.

### Records and capabilities

1. Write strict Zod schemas in `contracts/schemas.ts` for the master data the system of record publishes and for each captured record. Give every captured record the fields of `Delivered` from `@agent-native/integration`: `effectId`, `sync`, `sorRef` and `rejection`.
2. Without the scaffold, declare the target with `defineTarget` in the browser-safe contracts, as the [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md) skill describes. The declaration names the capability IDs, the settled resource types, the feed item and the status fields.
3. Declare each capture command with `defineCapability`, as the [add-capability](../../packages/runtime/skills/add-capability/SKILL.md) skill describes. Set `integration: { target, delivery: 'outbox' }`, the `dependencies` its live queries follow, and `ui.binding` or a stated `ui.exception`.
4. Declare container roles with `defineMembership`, as `examples/quality-inspection/contracts/membership.ts` does.
5. Declare keyed records with `defineCollection` and `collectionList`, as `examples/quality-inspection/contracts/collections.ts` does.
6. Compose the module with `defineModule` in `contracts.ts`, with a `requirements.network` entry for the target that sets `offline: 'queue'`. The target scaffold writes that entry; add workflow text that tells agents the order of capabilities.

### Handlers and policy

1. Write each capture handler on the pattern of `examples/quality-inspection/server/append-result.ts`. The handler does the following in order:
   - validates the input against local state;
   - calls `ctx.enqueue` with the target, a type, the record's resource and a payload;
   - stores the record with the returned effect ID and `sync: 'pending'`;
   - calls `ctx.change` for every changed resource.
2. Throw `ApplicationError` with `details.field` for an invalid input, so form bindings attach the message to the field.
3. Handle the membership command with `membershipHandler` from `@agent-native/runtime`. Pass `reserved` so no one can give the integration principal a role, as `examples/quality-inspection/handlers/supervision.ts` does.
4. Implement settle, sync and status with `targetHandlers` from `@agent-native/integration`, or adapt the generated handlers, with these options:
   - `cursor`, which returns the state object that holds `watermark` and `lastSyncAt`;
   - `onOutcome`, which calls `settleDelivery` on the record that forwarded the effect;
   - `applyBatch`, which applies feed items to local state;
   - `status`, which counts only records the caller may see.
5. In a generated application, remove the generated send command once the capture commands enqueue their own effects. Remove its handler, policy rule, screen form and test cases with it.
6. Write the policy with `definePolicy` as [Authorization](../../docs/authorization.md) describes, and pass `roleOf`, which returns the caller's role in a container. Without `roleOf` every container rule denies.
7. Keep or add `targetLane` for the integration principal and `targetRules` for the target's capabilities.
8. Give each capture capability a rule with a `container`, a `grant` and `roles`, and the membership command a `membershipRule`.
9. Declare `events` visibility per resource type in the policy.
10. Scope list rows before counting with the `visible` option of `collectionListHandler`, as `examples/quality-inspection/handlers/lots.ts` does.

### Connector

1. Write a connector that implements `SystemOfRecordPort` from `@agent-native/integration`, and keep the fake for tests. The connector reaches the target only through the network port.
2. Start the connector from `httpTargetPort` in [connector-http](../../plugins/connector-http/README.md) for a REST system, or from `fileTargetPort` in [connector-files](../../plugins/connector-files/README.md) for shared folders.
3. Implement `describe`, `deliver` and `pull`, and `lookup` when delivery is not idempotent by effect ID.
4. Report each delivery result in the form the port defines:
   - a business rejection returns `{ status: 'rejected', code, message }`;
   - a transient failure throws `DeliveryFailure`;
   - an outcome that cannot be established throws `DeliveryUncertain`;
   - an effect the target acknowledged but has not decided returns `{ status: 'pending' }`.
5. Pass the connector as the application's port option. This example takes `systemOfRecord`, and a generated application takes an option named for the target.
6. Bind the target's network destination in the deployment policy, as the [deploy-to-site](../../plugins/site/skills/deploy-to-site/SKILL.md) skill describes. A generated application lists it as disabled in `apps/desktop/site-policy.json`.

### Entrypoints

1. Write the manifest with `defineManifest`, listing the site, network, audit and compliance plugin manifests. A generated manifest already lists them.
2. Wire the application with `defineApplication`, passing the manifest, the handlers, the policy and the site, network, audit and compliance plugins. A generated application already does this with `createHandlers()` and `appPolicy` over flat state.
3. Keep the flat state unless the application composes several modules. This example keeps its state under one key and passes `sliceHandlers` and `composeAuthorization` with `authorizationRoute`, which the scaffold markers in a generated application do not expect.
4. In `connect`, call `connectTarget` with the target, the port, the integration principal and `toInput`. The scaffold writes the call without `toInput`, so add it when the pulled items need converting.
5. Write the screens with `defineScreens`, as the [build-screens](../../packages/frame/skills/build-screens/SKILL.md) and [add-scanner-input](../../packages/devices/skills/add-scanner-input/SKILL.md) skills describe. Bind commands with `useCapabilityForm`, read with live queries, and use `useCaptureLoop` and `useScannerInput` from `@agent-native/react/capture` for repeated entry.

### Reconciliation

This example composes no reconciliation, so a held effect has no screen in it. These steps follow the receiving example in the framework checkout.

1. Compose `reconciliationOperations` from `@agent-native/contracts` in the module, so a person can [resolve held effects](../../docs/primitives.md#reconciliation).
2. Mount `reconciliationFeature()` from `@agent-native/runtime` with an access view whose `sees` filters the held effects, and an `onResolved` hook that records the outcome as `onOutcome` would. `examples/receiving/application.ts` and `examples/receiving/handlers/reconciliation.ts` show both.
3. Add policy rules for the reconciliation list and resolve capabilities, as `examples/receiving/policy.ts` does.
4. Add a screen with the frame's `reconciliation-review` registry component, as `examples/receiving/ui/reconcile.tsx` does.

### Instrument driver

Follow the [write-hardware-driver](../../plugins/connector-driver/skills/write-hardware-driver/SKILL.md) skill for these steps, and skip them when the application has no instrument. In the framework checkout, the root application configuration names another application. Prefix every driver command there with `AGENT_NATIVE_APPLICATION` set to the application's package name. The blocks below write that name as `<package-name>`.

1. Declare the instrument with `defineDriverContract` and an empty `actions` map.
2. List `processPluginManifest` and `driverPluginManifest([contract])` in the manifest.
3. List `processPlugin` and `createDriverPlugin({ contracts })` in the application.
4. List `driverScreens` in the screens.
5. Add an ingest command for the driver's event with a `ui.exception`, and give it the rule `'integration'` in the policy.
6. Give the instrument principal its own policy lane with only the ingest command and `events: () => false`.
7. In the `observe` hook of `connect`, return no ingest unless `processes.availability` reports the driver process available.
8. Pass the ingest command to `createDriverEventIngest`, with `driverServiceOf(services)` and a context whose grant names only that command. Call `start` on the result and return it from `observe`.
9. Print the declared drivers to find the driver ID. It is the `id` given to `defineDriverContract`, which is `measuring-instrument` in this example.

   ```sh
   AGENT_NATIVE_APPLICATION=<package-name> bun run cli driver list
   ```

10. Write the contract document.

    ```sh
    AGENT_NATIVE_APPLICATION=<package-name> bun run cli driver contract <driver-id> --out <driver-id>.json
    ```

11. Generate the Python stub, with the SDK installed or with `PYTHONPATH` set to its `src` directory. In the framework checkout and in a source export, the SDK is in `sdks/driver-python`.

    ```sh
    PYTHONPATH=<driver-python>/src python3 -m agent_native_driver.stubgen <driver-id>.json -o <driver-directory>/<name>_contract.py
    ```

12. Write the driver with the Python SDK's `Driver` class, as the [driver-python README](../../sdks/driver-python/README.md) describes. Register `on_initialize` to open the equipment and return a list with one `Device` per unit.
13. Register `on_state`, `on_health` and `on_shutdown`, and send events with `emit`.
14. Copy `examples/quality-inspection/drivers/instrument/simulator.py` from the framework checkout into the driver directory. Only an export of this example already has it.
15. Start the simulator with its input held open, because it closes the device when its input ends. The first line of `simulator.out` is the device path for the check.

    ```sh
    tail -f /dev/null | python3 <driver-directory>/simulator.py > simulator.out &
    sleep 1
   head -n 1 simulator.out
    ```

16. Find the absolute path of uv, which the check command writes as `<uv>`. Any Python that has pyserial installed can replace the `<uv> run ... python` part.

    ```sh
    command -v uv
    ```

17. Check the driver against its contract. The check starts the driver with an empty environment, so pass the SDK path and the driver's settings through `/usr/bin/env` with absolute paths.

    ```sh
    AGENT_NATIVE_APPLICATION=<package-name> bun run cli driver check <driver-id> -- /usr/bin/env HOME=$HOME \
      PYTHONPATH=<driver-python>/src:<driver-directory> INSTRUMENT_PORT=<device-path> \
      <uv> run --offline --no-project --with pyserial python <driver-directory>/instrument_driver.py
    ```

18. Stop the simulator and its `tail` process.

    ```sh
    pkill -f "<driver-directory>/simulator.py"
    pkill -f "tail -f /dev/null"
    ```

19. Bind the driver's process in the deployment policy, with its executable, arguments and settings.

### Tests and checks

1. Write these tests. The connector test has no counterpart in this example.
   - `domain.test.ts`: `createApplication` with `createMemoryStorage`, driven by `createInboundSync` and `createEffectDispatcher` against the fake port;
   - `test/conformance.test.ts`: `startHost` with `integration: false`, then the same capture over HTTP, the CLI and MCP;
   - `test/ui-bindings.test.ts`: `unboundOperations` over the screens and the plugin screens;
   - `test/instrument.test.ts`: `createFakeDriver` from `@agent-native/connector-driver/testing`;
   - `test/instrument-driver.test.ts`: `checkDriver` against the real driver on a pseudo-terminal pair;
   - a connector test: `connectorConformance` from `@agent-native/testing/connectors` against the real port;
   - `e2e/`: Playwright specs with `startService` from `tests/e2e/service`.
2. Run the checks and report them as the [check-a-change](../../packages/testing/skills/check-a-change/SKILL.md) skill describes. The application directory is `examples/quality-inspection` in an export of this example and `examples/<app-name>` in a generated application.

   ```sh
   bun test <application-directory>
   bunx playwright test <application-directory>/e2e
   bun run check
   ```

## Limits

- **Fake quality system.** `FakeQualitySystem` is in memory and per process, and no real quality system has run against this example. Its documents and feed are gone when the process exits.
- **Instrument hardware.** The Python driver has run only against its pseudo-terminal simulator, on macOS. The driver tests skip without `python3` and `pyserial`, and the browser spec skips without uv and a cached `pyserial`.
- **Lost driver events.** A failed ingest is reported and not retried. The supervisor's sequence check reports events the driver lost.
- **Instrument readings.** The application keeps only the newest 20 instrument readings.
- **Corrections.** Only results can be corrected. A rejected defect or usage decision has no command in the application, and the Needs attention screen says to follow it up in the quality system.
- **Usage decisions.** No command reverts a decision, and capture stops once a lot is decided or closed.
- **Measurement age.** The instance refuses a measurement more than 24 hours old. A batch holds at most 100 measurements for one lot.
- **Held effects.** The example composes no reconciliation capabilities, so a held effect has no screen or command a person can use. The dispatcher holds an effect when the principal that committed it may no longer run its command at the first claim.
- **Uncertain deliveries.** The fake quality system is idempotent by effect ID and never reports an uncertain outcome. A real connector can also cause held effects for uncertain deliveries and lost acknowledgements.
- **State versions.** The example declares no numbered state migrations. Its `upgradeState` fills fields that older state lacks.

## Skills

- [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md)
- [write-hardware-driver](../../plugins/connector-driver/skills/write-hardware-driver/SKILL.md)
- [deploy-to-site](../../plugins/site/skills/deploy-to-site/SKILL.md)
- [build-screens](../../packages/frame/skills/build-screens/SKILL.md)

## References

- [System-of-record pattern](../../docs/systems-of-record.md)
- [Hardware drivers](../../docs/hardware-drivers.md)
- [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md)
- [write-hardware-driver](../../plugins/connector-driver/skills/write-hardware-driver/SKILL.md)
- [CRM capture](../crm-capture/README.md)
- [Receiving](../receiving/README.md)
- [Line station](../line-station/README.md)
- [create-agent-native-app](../../packages/scaffold/skills/create-agent-native-app/SKILL.md)
