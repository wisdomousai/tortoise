# Samples

The [samples](glossary.md#sample) in `samples/*` are small applications on one lab domain: test requests for specimens. `samples/lab-requests` is the base application. A technician submits a request with a description and assigns the test method, and viewers read the requests. Each other sample imports the base's module, handlers, policy and screens unchanged and adds one concern next to them.

## Concepts

Terms: [sample](glossary.md#sample), [application](glossary.md#application), [module](glossary.md#module), [policy](glossary.md#policy), [display metadata](glossary.md#display-metadata) and [UI intent](glossary.md#ui-intent).

## Base application

| File | Holds |
| --- | --- |
| `samples/lab-requests/contracts.ts` | The `lab-requests` module: the test request collection with its display metadata, `test-request.submit` and `test-request.update` |
| `samples/lab-requests/domain.ts`, `handlers.ts`, `policy.ts` | The `labRequests` state slice, the handlers and the technician and viewer policy |
| `samples/lab-requests/server.ts` | What an extension imports on the server |
| `samples/lab-requests/ui/requests.tsx` | The test request routes, navigation and capability screens that an extension spreads |
| `samples/lab-requests/application.ts`, `manifest.ts`, `screens.tsx` | The three entrypoints of the base application on its own |

The base keeps its state in a `labRequests` slice from the start, so an extension adds a slice beside it instead of moving it.

## Composition

An extension sample composes the base in each entrypoint:

- **Manifest:** the base's `labRequestsModule` next to the extension's module, feature or plugin manifests.
- **Handlers:** `sliceHandlers('labRequests', createLabRequestsHandlers())` runs the base handlers on the `labRequests` slice. The extension's own handlers are typed on the whole state, so they can read test requests.
- **Authorization:** `composeAuthorization` routes each module to its policy. The base route sees only the `labRequests` slice. An extension route that needs the base's members selects the whole state.
- **Screens:** the extension spreads `requestRoutes({ sections })`, `requestNavigation` and `requestCapabilityScreens`. A section is a component that the test request screen renders below the request, so an extension adds a panel without editing the base.

| Sample | Port | Concern | Framework parts it composes |
| --- | --- | --- | --- |
| `lab-requests` | 4350 | Collections, roles, revisions, idempotency, live queries, CLI and MCP without screens | `defineCollection`, `definePolicy`, `CollectionScreen`, `RecordScreen` |
| `lab-requests-system-of-record` | 4351 | Requests registered in an enterprise LIMS over REST: outbox, settlement, a held effect, inbound sync | `defineTarget`, `connectTarget`, `httpTargetPort`, `reconciliationHandlers` |
| `lab-requests-agents` | 4352 | Test method suggestions as approval requests, a trigger, UI intents from a run | `defineAgent`, `approvalHandlers`, `defineTrigger`, `useUiSession` |
| `lab-requests-host-plugin` | 4353 | An `activity` host plugin written in the sample | `definePluginManifest`, `defineHostPlugin`, `definePluginScreens` |
| `lab-requests-operations` | 4354 | A versioned state migration and telemetry on a site | `StateMigrations`, the site, network, audit and telemetry plugins |
| `lab-requests-review` | 4355 | A four-eyes review of a test request, written as a feature with an access view and hooks | `defineFeatureManifest`, `defineFeature`, `mountFeature`, `defineFeatureScreens`, `featureConformance` |
| `lab-requests-signals` | 4356 | Climate chamber temperature over OPC UA and humidity from Sparkplug B edge nodes, recorded through an ingest command | `opcUaServer`, `mqttBroker`, `createOpcUaObserver`, `createMqttObserver`, the site, network and audit plugins |
| `lab-requests-local-model` | 4357 | The method suggester run by a trigger on a measured local model, a dataset of decided suggestions and a gated fine-tune | `defineModelEntry`, `createModelServer`, `createAutomationPlugin`, `exportApprovalDataset`, `gateModel` |
| `lab-requests-sign-in` | 4358 | Technicians sign in at a shared bench with a badge and PIN and submit test requests as themselves; the owner enrolls badges | `createStationSignInPlugin`, `stationSignInScreens`, `useOperatorSession`, `useScanner`, `numeric-pad` |

Each sample's README lists its files, its trust boundary and one line per test file.

## Use

Run a sample in the browser from its directory:

```sh
cd samples/lab-requests-agents
bun run dev:web
```

Run the tests of one sample, or of all of them. The trailing slash keeps `bun test` from matching the other `lab-requests-*` directories:

```sh
bun test samples/lab-requests-agents/
bun test samples
```

A sample with a `dev.ts` starts its fake system or seeds records first. `lab-requests-system-of-record` starts a fake LIMS on port 4371. `lab-requests-operations` starts the collector stand-in from `@agent-native/telemetry/testing` on port 4318 when no OpenTelemetry Collector listens there. `lab-requests-review` submits one request as a second technician, so the local owner has a request to review. `lab-requests-signals` starts an OPC UA gateway on port 4374 and an MQTT broker on port 4373 for its climate chambers. `lab-requests-local-model` binds its model server to port 4375 and runs the llama-server stand-in, or llama-server itself when `LOCAL_MODEL_GGUF` names weights.

## Limits

- No sample runs agent tools in the execution host, which runs only on Linux with bubblewrap.
- The samples have no Playwright specs. `bun run check` runs their behavioral and UI-binding tests.

## References

- [Lab requests](../samples/lab-requests/README.md)
- [Lab requests system of record](../samples/lab-requests-system-of-record/README.md)
- [Lab requests agents](../samples/lab-requests-agents/README.md)
- [Lab requests host plugin](../samples/lab-requests-host-plugin/README.md)
- [Lab requests operations](../samples/lab-requests-operations/README.md)
- [Lab requests review](../samples/lab-requests-review/README.md)
- [Lab requests signals](../samples/lab-requests-signals/README.md)
- [Lab requests local model](../samples/lab-requests-local-model/README.md)
- [Lab requests sign-in](../samples/lab-requests-sign-in/README.md)
- [Architecture](architecture.md)
- [Capability authoring](capability-authoring.md)
