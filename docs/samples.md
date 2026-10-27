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
| `lab-requests-site` | 4359 | The lab as a site of the fleet example: enrollment, reports, audit forwarding, a signed release staged and installed with its unit and firewall rules | `createFleetAgentPlugin`, `createBundle`, `site install`, `network export`, the site, network and audit plugins |
| `lab-requests-sandbox` | 4360 | Tensile readings analyzed by a tool in a bubblewrap sandbox, which reads and records through the application CLI with a run-bound token | `executionSandbox`, `createExecutionHostPlugin`, `agentGrant`, `defineHostPlugin`, the site, network and process plugins |
| `lab-requests-hosted` | 4361 | The request desk served from Postgres under a workspace lease, with lab staff signed in through an OpenID Connect provider | `hostedPlatform`, `PostgresStorage`, `--hosted-workspace`, `identity: external`, `startIdentityProvider`, the site and network plugins |

Each sample's README lists its files, its trust boundary and one line per test file.

## Primitive coverage

A dash means that no sample, or no example, shows the primitive.

| Primitive | Sample | Example |
| --- | --- | --- |
| Capability | `lab-requests` | `field-service` |
| Module | `lab-requests` | `field-service`, `asset-survey` |
| Feature | `lab-requests-review` | `field-service`, `line-station`, `receiving` |
| Catalog | `lab-requests` | `crm-capture` |
| Generator | every sample | every example |
| Instance | `lab-requests` | `field-service` |
| Command | `lab-requests` | `field-service` |
| Query | `lab-requests` | `field-service` |
| Nested invocation | — | `asset-survey` |
| Collection | `lab-requests` | `fleet`, `receiving`, `quality-inspection` |
| Execution context | `lab-requests-sandbox` | `crm-capture` |
| Policy | `lab-requests` | `field-service` |
| Membership | — | `line-station`, `quality-inspection`, `fleet` |
| Storage | `lab-requests`, `lab-requests-hosted` | `field-service` |
| State migration | `lab-requests-operations` | `field-service`, `line-station`, `quality-inspection`, `receiving` |
| Blob store | — | `field-service`, `asset-survey` |
| Journal and live query | `lab-requests` | `field-service` |
| Application | every sample | every example |
| Host | every sample | every example |
| Host plugin | `lab-requests-host-plugin` | `field-service` |
| Host platform | `lab-requests-hosted` | `field-service`, `asset-survey-field` |
| Workspace lease | `lab-requests-hosted` | `field-service` |
| Web frame | every sample | every example except `asset-survey-field` |
| Native frame | — | `asset-survey-field` |
| Starter | — | `field-service`, the application `app.config.json` names |
| Surface adapter | `lab-requests` | `field-service` |
| Capability binding | `lab-requests` | every example |
| Display metadata | `lab-requests` | `fleet` |
| UI session context | `lab-requests-agents` | `field-service` |
| Agent run | `lab-requests-agents` | `field-service` |
| Agent definition | `lab-requests-agents`, `lab-requests-local-model`, `lab-requests-sandbox` | `field-service`, `line-station`, `receiving` |
| Model entry | `lab-requests-local-model` | — |
| Approval request | `lab-requests-agents` | `field-service`, `receiving`, `line-station` |
| Approval dataset | `lab-requests-local-model` | — |
| Trigger | `lab-requests-agents` with a job, `lab-requests-local-model` with an agent definition | `line-station` |
| Standing grant | `lab-requests-agents` | `line-station` |
| Workflow | — | `asset-survey` |
| Input source | `lab-requests-sign-in` | `line-station`, `asset-survey-field` |
| OS handler | — | `field-service`, `asset-survey-field` |
| OS action | — | `field-service`, `asset-survey-field` |
| Shell port | — | `field-service` |
| Process port | `lab-requests-local-model`, `lab-requests-sandbox` | `line-station`, `quality-inspection`, `asset-survey` |
| UI registry | `lab-requests-sign-in` | `line-station`, `quality-inspection`, `asset-survey-field` |
| Outbox effect | `lab-requests-system-of-record` | `quality-inspection`, `asset-survey` |
| Connector | `lab-requests-system-of-record` | `quality-inspection`, `receiving` |
| Dispatcher | `lab-requests-system-of-record` | `quality-inspection` |
| Inbound sync | `lab-requests-system-of-record` | `quality-inspection`, `asset-survey` |
| Target | `lab-requests-system-of-record` | `quality-inspection`, `receiving`, `crm-capture` |
| Peer target | — | `asset-survey`, `asset-survey-field`, `quality-inspection`, `receiving` |
| Peer link | — | `quality-inspection`, `receiving` |
| Remote query | — | `crm-capture`, `asset-survey` |
| Data provider | — | `crm-capture`, `asset-survey`, `receiving` |
| Observation | `lab-requests-signals` | `line-station`, `quality-inspection` |
| Gated actuator | — | `line-station` |
| Driver contract | — | `line-station`, `quality-inspection` |
| Driver process | — | `line-station`, `quality-inspection` |
| Driver SDK | — | `line-station` with .NET, `quality-inspection` with Python |
| Reconciliation | `lab-requests-system-of-record` | `receiving`, `quality-inspection`, `line-station` |
| Worker claims | `lab-requests-system-of-record` | `quality-inspection` |
| Credential vault | — | `field-service` |
| Device link | — | `asset-survey`, `asset-survey-field`, `fleet` |
| Requirement declaration | `lab-requests-system-of-record`, `lab-requests-signals` | `asset-survey`, `quality-inspection` |
| Deployment policy | `lab-requests-operations`, `lab-requests-site` | `quality-inspection`, `receiving`, `field-service` |
| Workforce sign-in | `lab-requests-hosted` | `field-service` |
| Workstation sign-in | `lab-requests-sign-in` | — |
| Egress guard | `lab-requests-system-of-record`, `lab-requests-signals` | `field-service`, `quality-inspection` |
| Audit log | `lab-requests-operations`, `lab-requests-site` | `field-service`, `fleet`, `quality-inspection` |
| Execution host | `lab-requests-sandbox` | — |
| Station and scanner profiles | — | `line-station` |
| Device configuration | — | `line-station` |
| Golden check | — | `line-station` |
| Compliance bundle | — | `quality-inspection` |
| Behavioral scenario | `lab-requests`, `lab-requests-host-plugin`, `lab-requests-review` | `field-service` |
| Agent scenario | `lab-requests-agents`, `lab-requests-local-model` | `receiving` |
| Scaffold | — | `receiving`, `field-service` |
| Framework release | — | — |
| Task package | `lab-requests-site` | — |
| Fleet agent | `lab-requests-site` | `fleet` |
| Telemetry | `lab-requests-operations` | — |

The generator, the scaffold and the framework release are tools that run on content:

- `bun run generate` writes the reference of every sample and example to `dist/reference/`.
- `receiving` was generated with `scaffold new` and extended with `scaffold add`. `bun run test:scaffold:full` exports the starter with `field-service`, and generates an application with `scaffold new`.
- The same suite packs the framework release, serves it from a loopback registry as `bun run release:serve` does, and installs it into an application made with `scaffold new --registry`.

## Workspace coverage

| Workspace | Shown in |
| --- | --- |
| `packages/contracts`, `packages/runtime`, `packages/host`, `packages/testing` | every sample and example |
| `packages/kernel` | every sample and example, through `packages/host` |
| `packages/adapters` | every sample and example, through HTTP, the CLI and MCP |
| `packages/client` | every web screen, through the frame; `lab-requests-site` `publish-release.ts`; the `field-service` tests |
| `packages/frame` | every sample and example except `asset-survey-field` |
| `packages/frame-native`, `packages/mobile`, `apps/mobile` | `asset-survey-field` |
| `packages/react` | `crm-capture`, `quality-inspection`, `asset-survey` |
| `packages/operator-ui` | `lab-requests-sign-in`, `line-station`, `quality-inspection`, through its registry items |
| `packages/devices` | `line-station`, `asset-survey-field` |
| `packages/integration` | `lab-requests-system-of-record`, `quality-inspection`, `receiving`, `crm-capture`, `asset-survey`, `line-station` |
| `packages/observation` | `lab-requests-signals` |
| `packages/agents` | `lab-requests-agents`, `lab-requests-local-model`, `field-service`, `receiving` |
| `packages/event-log` | `lab-requests-operations`, `field-service`, `fleet`, `quality-inspection` |
| `packages/bundle` | `lab-requests-site`, `fleet` |
| `packages/shell` | `field-service`, `asset-survey-field` |
| `packages/scaffold` | `receiving`, `field-service` |
| `plugins/site`, `plugins/network` | seven samples, including `lab-requests-operations` and `lab-requests-site`; every example except `asset-survey-field` |
| `plugins/audit` | `lab-requests-operations`, `lab-requests-site`, `lab-requests-signals`, `lab-requests-system-of-record`, `lab-requests-local-model`; every example except `asset-survey-field` |
| `plugins/compliance` | `field-service`, `quality-inspection`, `line-station`, `receiving`, `crm-capture`, `asset-survey` |
| `plugins/automation` | `lab-requests-agents`, `lab-requests-local-model`, `line-station` |
| `plugins/workflows` | `asset-survey` |
| `plugins/process` | `lab-requests-local-model`, `lab-requests-sandbox`, `line-station`, `quality-inspection`, `asset-survey` |
| `plugins/connector-http` | `lab-requests-system-of-record` |
| `plugins/connector-files` | `receiving` |
| `plugins/connector-mqtt`, `plugins/connector-opcua` | `lab-requests-signals` |
| `plugins/connector-driver` | `line-station`, `quality-inspection` |
| `plugins/peer-link` | `quality-inspection`, `receiving` |
| `plugins/device-link` | `asset-survey`, `fleet` |
| `plugins/hub-link`, `plugins/intent-scanner`, `plugins/managed-config`, `plugins/android-intents` | `asset-survey-field` |
| `plugins/os`, `plugins/share-target`, `plugins/notifications` | `field-service`, `asset-survey-field` |
| `plugins/os-shortcuts`, `plugins/webhook` | `field-service` |
| `plugins/model-server` | `lab-requests-local-model` |
| `plugins/execution-host` | `lab-requests-sandbox` |
| `plugins/fleet-agent` | `lab-requests-site`, `fleet` |
| `plugins/telemetry` | `lab-requests-operations` |
| `workstations/screen-bridge` | `line-station` |
| `workstations/sign-in` | `lab-requests-sign-in` |
| `sdks/driver-dotnet` | `line-station` |
| `sdks/driver-python` | `quality-inspection` |
| `apps/service`, `apps/web` | `bun run dev:web` in every sample and example |
| `apps/desktop` | `bun run dev` in every sample and example; `bun run package:stage` packages `field-service` |

## Technology coverage

| Technology | Shown in |
| --- | --- |
| SQLite through `bun:sqlite` | every sample and example on a desktop or server |
| Postgres through `Bun.SQL` | `lab-requests-hosted` |
| PGlite | the tests of `lab-requests-hosted`; `field-service` `test/storage-conformance.test.ts` |
| CASL | `field-service` `policy.ts` |
| Zod and JSON Schema | every contract |
| Model Context Protocol SDK | `bun run mcp` for every application; `field-service` `test/transport-conformance.test.ts` |
| OpenID Connect through `jose` | `lab-requests-hosted` |
| OS keychain through `@napi-rs/keyring` | the `field-service` agent panel's provider keys |
| AI SDK | the `field-service` agent panel; the local harness in `lab-requests-local-model` |
| Claude Agent SDK, Codex app-server | the `field-service` agent panel, with a staged runtime manifest |
| llama.cpp `llama-server` | `lab-requests-local-model`, with `LOCAL_MODEL_GGUF` |
| vLLM | — |
| bubblewrap | `lab-requests-sandbox` on Linux |
| OPC UA | `lab-requests-signals` |
| MQTT and Sparkplug B | `lab-requests-signals` |
| OpenTelemetry over OTLP | `lab-requests-operations` |
| systemd units and nftables rules | `lab-requests-site`, through `site install` and `network export` |
| React, Vite, TanStack Router, Query and Table | every web screen, through the frame |
| TanStack Form | `crm-capture`, `quality-inspection`, `asset-survey` |
| shadcn and Tailwind CSS | every web screen; the registry items `lab-requests-sign-in` uses |
| `bwip-js` barcodes | the `line-station` scanner setup |
| Electron and electron-builder | `bun run dev` desktop windows; `bun run package:stage` |
| Expo, React Native, React Navigation, Uniwind | `asset-survey-field` |
| `expo-notifications`, `expo-sqlite`, `expo-secure-store`, `expo-background-task`, `expo-file-system` | `asset-survey-field` |
| `expo-sharing` | — |
| `react-native-webview` | `asset-survey-field`, through hub link |
| The Android intents Kotlin module | `asset-survey-field` |
| .NET 10 | the `line-station` automation driver |
| Python and `pyserial` | the `quality-inspection` instrument driver |
| Playwright | the `e2e/` specs of every example except `asset-survey-field` |
| Changesets | the framework release |

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

A sample with a `dev.ts` starts its fake system or seeds records first. `lab-requests-system-of-record` starts a fake LIMS on port 4371. `lab-requests-operations` starts the collector stand-in from `@agent-native/telemetry/testing` on port 4318 when no OpenTelemetry Collector listens there. `lab-requests-review` submits one request as a second technician, so the local owner has a request to review. `lab-requests-signals` starts an OPC UA gateway on port 4374 and an MQTT broker on port 4373 for its climate chambers. `lab-requests-local-model` binds its model server to port 4375 and runs the llama-server stand-in, or llama-server itself when `LOCAL_MODEL_GGUF` names weights. `lab-requests-site` writes a policy that binds the fleet example on port 4340 and a temporary releases folder, and prints the folder. `lab-requests-sandbox` binds its sandbox to `/usr/bin/bwrap` on Linux when bubblewrap is there. `lab-requests-hosted` starts the stand-in identity provider on port 4372 with the certificate its environment names, and needs `AGENT_NATIVE_DATABASE_URL`.

## Limits

- The execution host runs only on Linux with bubblewrap. Elsewhere `lab-requests-sandbox` shows the unavailable path, and its sandbox tests skip.
- `lab-requests-hosted` runs only against a Postgres server, and its browser sign-in needs a certificate the browser trusts, such as one from mkcert. Its tests use PGlite and a throwaway CA instead.
- The samples have no Playwright specs. `bun run check` runs their behavioral and UI-binding tests.
- No content serves a model with vLLM. The model server's own tests cover its vLLM arguments.
- No content reaches `expo-sharing`, which receives what another app shares, because `asset-survey-field` declares no share handler. Its share action uses the React Native share sheet.
- No content runs the `reveal` and `open-file` OS actions, because the OS plugin has no file root.
- The Codex and Claude harnesses in `field-service` need a staged runtime manifest and the person's own accounts. The implementation ledger records no provider run on `field-service`.
- The native parts of `asset-survey-field`, the Android intents module and the Expo config plugins, compile only in a native build.

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
- [Lab requests site](../samples/lab-requests-site/README.md)
- [Lab requests sandbox](../samples/lab-requests-sandbox/README.md)
- [Lab requests hosted](../samples/lab-requests-hosted/README.md)
- [Architecture](architecture.md)
- [Capability authoring](capability-authoring.md)
- [Primitives](primitives.md)
- [Examples](architecture.md#examples)
- [Implementation status](implementation-status.md)
