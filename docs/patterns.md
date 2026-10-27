# Patterns

The [patterns](glossary.md#pattern) in `showcase/patterns/*` show one technical concern each, such as a system of record, an agent, a sandbox or plant signals. The [examples](glossary.md#example) in `showcase/examples/*` are whole applications for real-world cases instead. The patterns are small applications for one case: a manufacturer of power transformers whose oil lab tests samples drawn from transformers in service. `showcase/patterns/base` is the base application. A technician submits a test request for an oil sample with its transformer and a description, a technician assigns the test method, and viewers read the requests. Each other pattern imports the base's module, handlers, policy and screens unchanged and adds one concern next to them.

## Concepts

Terms: [pattern](glossary.md#pattern), [application](glossary.md#application), [module](glossary.md#module), [policy](glossary.md#policy), [display metadata](glossary.md#display-metadata) and [UI intent](glossary.md#ui-intent).

## Base application

| File | Holds |
| --- | --- |
| `showcase/patterns/base/contracts.ts` | The `test-requests` module: the test request collection with its display metadata, `test-request.submit` and `test-request.update` |
| `showcase/patterns/base/domain.ts`, `handlers.ts`, `policy.ts` | The `testRequests` state slice, the handlers and the technician and viewer policy |
| `showcase/patterns/base/server.ts` | What an extension imports on the server |
| `showcase/patterns/base/ui/requests.tsx` | The test request routes, navigation and capability screens that an extension spreads |
| `showcase/patterns/base/application.ts`, `manifest.ts`, `screens.tsx` | The three entrypoints of the base application on its own |

The base keeps its state in a `testRequests` slice from the start, so an extension adds a slice beside it instead of moving it.

## Composition

An extension pattern composes the base in each entrypoint:

- **Manifest:** the base's `testRequestsModule` next to the extension's module, feature or plugin manifests.
- **Handlers:** `sliceHandlers('testRequests', createTestRequestsHandlers())` runs the base handlers on the `testRequests` slice. The extension's own handlers are typed on the whole state, so they can read test requests.
- **Authorization:** `composeAuthorization` routes each module to its policy. The base route sees only the `testRequests` slice. An extension route that needs the base's members selects the whole state.
- **Screens:** the extension spreads `requestRoutes({ sections })`, `requestNavigation` and `requestCapabilityScreens`. A section is a component that the test request screen renders below the request, so an extension adds a panel without editing the base.

| Pattern | Port | Concern | Framework parts it composes |
| --- | --- | --- | --- |
| `test-requests` | 4350 | Collections, roles, revisions, idempotency, live queries, CLI and MCP without screens | `defineCollection`, `definePolicy`, `CollectionScreen`, `RecordScreen` |
| `system-of-record` | 4351 | Requests registered in an enterprise LIMS over REST: outbox, settlement, a held effect, inbound sync | `defineTarget`, `connectTarget`, `httpTargetPort`, `reconciliationHandlers` |
| `agents` | 4352 | Test method suggestions as approval requests, a trigger, UI intents from a run | `defineAgent`, `approvalHandlers`, `defineTrigger`, `useUiSession` |
| `host-plugin` | 4353 | An `activity` host plugin written in the pattern | `definePluginManifest`, `defineHostPlugin`, `definePluginScreens` |
| `operations` | 4354 | A versioned state migration and telemetry on a site | `StateMigrations`, the site, network, audit and telemetry plugins |
| `review` | 4355 | A four-eyes review of a test request, written as a feature with an access view and hooks | `defineFeatureManifest`, `defineFeature`, `mountFeature`, `defineFeatureScreens`, `featureConformance` |
| `signals` | 4356 | Climate chamber temperature over OPC UA and humidity from Sparkplug B edge nodes, recorded through an ingest command | `opcUaServer`, `mqttBroker`, `createOpcUaObserver`, `createMqttObserver`, the site, network and audit plugins |
| `local-model` | 4357 | The method suggester run by a trigger on a measured local model, a dataset of decided suggestions and a gated fine-tune | `defineModelEntry`, `createModelServer`, `createAutomationPlugin`, `exportApprovalDataset`, `gateModel` |
| `sign-in` | 4358 | Technicians sign in at a shared bench with a badge and PIN and submit test requests as themselves; the owner enrolls badges | `createStationSignInPlugin`, `stationSignInScreens`, `useOperatorSession`, `useScanner`, `numeric-pad` |
| `site` | 4359 | The oil lab as a site of the fleet example: enrollment, reports, audit forwarding, a signed release staged and installed with its unit and firewall rules | `createFleetAgentPlugin`, `createBundle`, `app install`, `network export`, the site, network and audit plugins |
| `sandbox` | 4360 | Breakdown voltage readings analyzed by a tool in a bubblewrap sandbox, which reads and records through the application CLI with a run-bound token | `executionSandbox`, `createExecutionHostPlugin`, `agentGrant`, `defineHostPlugin`, the site, network and process plugins |
| `hosted` | 4361 | The request desk served from Postgres under a workspace lease, with lab staff signed in through an OpenID Connect provider | `hostedPlatform`, `PostgresStorage`, `--hosted-workspace`, `identity: external`, `startIdentityProvider`, the site and network plugins |

Each pattern's README lists its files, its trust boundary and one line per test file.

## Primitive coverage

A dash means that no pattern, or no example, shows the primitive.

| Primitive | Pattern | Example |
| --- | --- | --- |
| Capability | `test-requests` | `field-service` |
| Module | `test-requests` | `field-service`, `asset-survey` |
| Feature | `review` | `field-service`, `winding-line`, `receiving` |
| Catalog | `test-requests` | `crm-capture` |
| Generator | every pattern | every example |
| Instance | `test-requests` | `field-service` |
| Command | `test-requests` | `field-service` |
| Query | `test-requests` | `field-service` |
| Nested invocation | — | `asset-survey` |
| Collection | `test-requests` | `fleet`, `receiving`, `quality-inspection` |
| Execution context | `sandbox` | `crm-capture` |
| Policy | `test-requests` | `field-service` |
| Membership | — | `winding-line`, `quality-inspection`, `fleet` |
| Storage | `test-requests`, `hosted` | `field-service` |
| State migration | `operations` | `field-service`, `winding-line`, `quality-inspection`, `receiving` |
| Blob store | — | `field-service`, `asset-survey` |
| Journal and live query | `test-requests` | `field-service` |
| Application | every pattern | every example |
| Host | every pattern | every example |
| Host plugin | `host-plugin` | `field-service` |
| Host platform | `hosted` | `field-service`, `asset-survey-field` |
| Workspace lease | `hosted` | `field-service` |
| Web frame | every pattern | every example except `asset-survey-field` |
| Native frame | — | `asset-survey-field` |
| Starter | — | `field-service`, the application `app.config.json` names |
| Surface adapter | `test-requests` | `field-service` |
| Capability binding | `test-requests` | every example |
| Display metadata | `test-requests` | `fleet` |
| UI session context | `agents` | `field-service` |
| Agent run | `agents` | `field-service` |
| Agent definition | `agents`, `local-model`, `sandbox` | `field-service`, `winding-line`, `receiving` |
| Model entry | `local-model` | — |
| Approval request | `agents` | `field-service`, `receiving`, `winding-line` |
| Approval dataset | `local-model` | — |
| Trigger | `agents` with a job, `local-model` with an agent definition | `winding-line` |
| Standing grant | `agents` | `winding-line` |
| Workflow | — | `asset-survey` |
| Assignment | — | `asset-survey` |
| Worklist | — | `asset-survey-field` |
| Input source | `sign-in` | `winding-line`, `asset-survey-field` |
| OS handler | — | `field-service`, `asset-survey-field` |
| OS action | — | `field-service`, `asset-survey-field` |
| Shell port | — | `field-service` |
| Process port | `local-model`, `sandbox` | `winding-line`, `quality-inspection`, `asset-survey` |
| UI registry | `sign-in` | `winding-line`, `quality-inspection`, `asset-survey-field` |
| Outbox effect | `system-of-record` | `quality-inspection`, `asset-survey` |
| Connector | `system-of-record` | `quality-inspection`, `receiving` |
| Dispatcher | `system-of-record` | `quality-inspection` |
| Inbound sync | `system-of-record` | `quality-inspection`, `asset-survey` |
| Target | `system-of-record` | `quality-inspection`, `receiving`, `crm-capture` |
| Peer target | — | `asset-survey`, `asset-survey-field`, `quality-inspection`, `receiving` |
| Peer link | — | `quality-inspection`, `receiving` |
| Remote query | — | `crm-capture`, `asset-survey` |
| Data provider | — | `crm-capture`, `asset-survey`, `receiving` |
| Observation | `signals` | `winding-line`, `quality-inspection` |
| Gated actuator | — | `winding-line` |
| Driver contract | — | `winding-line`, `quality-inspection` |
| Driver process | — | `winding-line`, `quality-inspection` |
| Driver SDK | — | `winding-line` with .NET, `quality-inspection` with Python |
| Reconciliation | `system-of-record` | `receiving`, `quality-inspection`, `winding-line` |
| Worker claims | `system-of-record` | `quality-inspection` |
| Credential vault | — | `field-service` |
| Device link | — | `asset-survey`, `asset-survey-field`, `fleet` |
| Requirement declaration | `system-of-record`, `signals` | `asset-survey`, `quality-inspection` |
| Deployment policy | `operations`, `site` | `quality-inspection`, `receiving`, `field-service` |
| Workforce sign-in | `hosted` | `field-service` |
| Workstation sign-in | `sign-in` | — |
| Egress guard | `system-of-record`, `signals` | `field-service`, `quality-inspection` |
| Audit log | `operations`, `site` | `field-service`, `fleet`, `quality-inspection` |
| Execution host | `sandbox` | — |
| Station and scanner profiles | — | `winding-line` |
| Device configuration | — | `winding-line` |
| Golden check | — | `winding-line` |
| Compliance bundle | — | `quality-inspection` |
| Behavioral scenario | `test-requests`, `host-plugin`, `review` | `field-service` |
| Agent scenario | `agents`, `local-model` | `receiving` |
| Scaffold | — | `receiving`, `field-service` |
| Framework release | — | — |
| Task package | `site` | — |
| Fleet agent | `site` | `fleet` |
| Telemetry | `operations` | — |

The generator, the scaffold and the framework release are tools that run on content:

- `bun run generate` writes the reference of every pattern and example to `dist/reference/`.
- `receiving` was generated with `scaffold new` and extended with `scaffold add`. `bun run test:scaffold:full` exports the starter with `field-service`, and generates an application with `scaffold new`.
- The same suite packs the framework release, serves it from a loopback registry as `bun run release:serve` does, and installs it into an application made with `scaffold new --registry`.

## Workspace coverage

| Workspace | Shown in |
| --- | --- |
| `packages/contracts`, `packages/runtime`, `packages/host`, `packages/testing` | every pattern and example |
| `packages/kernel` | every pattern and example, through `packages/host` |
| `packages/adapters` | every pattern and example, through HTTP, the CLI and MCP |
| `packages/client` | every web screen, through the frame; `site` `publish-release.ts`; the `field-service` tests |
| `packages/frame` | every pattern and example except `asset-survey-field` |
| `packages/frame-native`, `packages/mobile`, `apps/mobile` | `asset-survey-field` |
| `packages/assignments` | `asset-survey`, `asset-survey-field` |
| `packages/react` | `crm-capture`, `quality-inspection`, `asset-survey` |
| `packages/operator-ui` | `sign-in`, `winding-line`, `quality-inspection`, through its registry items |
| `packages/devices` | `winding-line`, `asset-survey-field` |
| `packages/integration` | `system-of-record`, `quality-inspection`, `receiving`, `crm-capture`, `asset-survey`, `winding-line` |
| `packages/observation` | `signals` |
| `packages/agents` | `agents`, `local-model`, `field-service`, `receiving` |
| `packages/event-log` | `operations`, `field-service`, `fleet`, `quality-inspection` |
| `packages/bundle` | `site`, `fleet` |
| `packages/shell` | `field-service`, `asset-survey-field` |
| `packages/scaffold` | `receiving`, `field-service` |
| `plugins/site`, `plugins/network` | seven patterns, including `operations` and `site`; every example except `asset-survey-field` |
| `plugins/audit` | `operations`, `site`, `signals`, `system-of-record`, `local-model`; every example except `asset-survey-field` |
| `plugins/compliance` | `field-service`, `quality-inspection`, `winding-line`, `receiving`, `crm-capture`, `asset-survey` |
| `plugins/automation` | `agents`, `local-model`, `winding-line` |
| `plugins/workflows` | `asset-survey` |
| `plugins/process` | `local-model`, `sandbox`, `winding-line`, `quality-inspection`, `asset-survey` |
| `plugins/connector-http` | `system-of-record` |
| `plugins/connector-files` | `receiving` |
| `plugins/connector-mqtt`, `plugins/connector-opcua` | `signals` |
| `plugins/connector-driver` | `winding-line`, `quality-inspection` |
| `plugins/peer-link` | `quality-inspection`, `receiving` |
| `plugins/device-link` | `asset-survey`, `fleet` |
| `plugins/hub-link`, `plugins/intent-scanner`, `plugins/managed-config`, `plugins/android-intents` | `asset-survey-field` |
| `plugins/os`, `plugins/share-target`, `plugins/notifications` | `field-service`, `asset-survey-field` |
| `plugins/os-shortcuts`, `plugins/webhook` | `field-service` |
| `plugins/model-server` | `local-model` |
| `plugins/execution-host` | `sandbox` |
| `plugins/fleet-agent` | `site`, `fleet` |
| `plugins/telemetry` | `operations` |
| `workstations/screen-bridge` | `winding-line` |
| `workstations/sign-in` | `sign-in` |
| `sdks/driver-dotnet` | `winding-line` |
| `sdks/driver-python` | `quality-inspection` |
| `apps/service`, `apps/web` | `bun run dev:web` in every pattern and example |
| `apps/desktop` | `bun run dev` in every pattern and example; `bun run package:stage` packages `field-service` |

## Technology coverage

| Technology | Shown in |
| --- | --- |
| SQLite through `bun:sqlite` | every pattern and example on a desktop or server |
| Postgres through `Bun.SQL` | `hosted` |
| PGlite | the tests of `hosted`; `field-service` `test/storage-conformance.test.ts` |
| CASL | `field-service` `policy.ts` |
| Zod and JSON Schema | every contract |
| Model Context Protocol SDK | `bun run mcp` for every application; `field-service` `test/transport-conformance.test.ts` |
| OpenID Connect through `jose` | `hosted` |
| OS keychain through `@napi-rs/keyring` | the `field-service` agent panel's provider keys |
| AI SDK | the `field-service` agent panel; the local harness in `local-model` |
| Claude Agent SDK, Codex app-server | the `field-service` agent panel, with a staged runtime manifest |
| llama.cpp `llama-server` | `local-model`, with `LOCAL_MODEL_GGUF` |
| vLLM | — |
| bubblewrap | `sandbox` on Linux |
| OPC UA | `signals` |
| MQTT and Sparkplug B | `signals` |
| OpenTelemetry over OTLP | `operations` |
| systemd units and nftables rules | `site`, through `app install` and `network export` |
| React, Vite, TanStack Router, Query and Table | every web screen, through the frame |
| TanStack Form | `crm-capture`, `quality-inspection`, `asset-survey` |
| shadcn and Tailwind CSS | every web screen; the registry items `sign-in` uses |
| `bwip-js` barcodes | the `winding-line` scanner setup |
| Electron and electron-builder | `bun run dev` desktop windows; `bun run package:stage` |
| Expo, React Native, React Navigation, Uniwind | `asset-survey-field` |
| `expo-notifications`, `expo-sqlite`, `expo-secure-store`, `expo-background-task`, `expo-file-system` | `asset-survey-field` |
| `expo-sharing` | — |
| `react-native-webview` | `asset-survey-field`, through hub link |
| The Android intents Kotlin module | `asset-survey-field` |
| .NET 10 | the `winding-line` automation driver |
| Python and `pyserial` | the `quality-inspection` instrument driver |
| Playwright | the `e2e/` specs of every example except `asset-survey-field` |
| Changesets | the framework release |

## Use

Run a pattern in the browser from its directory:

```sh
cd showcase/patterns/agents
bun run dev:web
```

Run the tests of one pattern, or of all of them:

```sh
bun test showcase/patterns/agents/
bun test patterns
```

A pattern with a `dev.ts` starts its fake system or seeds records first. `system-of-record` starts a fake LIMS on port 4371. `operations` starts the collector stand-in from `@agent-native/telemetry/testing` on port 4318 when no OpenTelemetry Collector listens there. `review` submits one request as a second technician, so the local owner has a request to review. `signals` starts an OPC UA gateway on port 4374 and an MQTT broker on port 4373 for its climate chambers. `local-model` binds its model server to port 4375 and runs the llama-server stand-in, or llama-server itself when `LOCAL_MODEL_GGUF` names weights. `site` writes a policy that binds the fleet example on port 4340 and a temporary releases folder, and prints the folder. `sandbox` binds its sandbox to `/usr/bin/bwrap` on Linux when bubblewrap is there. `hosted` starts the stand-in identity provider on port 4372 with the certificate its environment names, and needs `AGENT_NATIVE_DATABASE_URL`.

## Limits

- The execution host runs only on Linux with bubblewrap. Elsewhere `sandbox` shows the unavailable path, and its sandbox tests skip.
- `hosted` runs only against a Postgres server, and its browser sign-in needs a certificate the browser trusts, such as one from mkcert. Its tests use PGlite and a throwaway CA instead.
- The patterns have no Playwright specs. `bun run check` runs their behavioral and UI-binding tests.
- No content serves a model with vLLM. The model server's own tests cover its vLLM arguments.
- No content reaches `expo-sharing`, which receives what another app shares, because `asset-survey-field` declares no share handler. Its share action uses the React Native share sheet.
- No content runs the `reveal` and `open-file` OS actions, because the OS plugin has no file root.
- The Codex and Claude harnesses in `field-service` need a staged runtime manifest and the person's own accounts. The implementation ledger records no provider run on `field-service`.
- The native parts of `asset-survey-field`, the Android intents module and the Expo config plugins, compile only in a native build.

## References

- [Base pattern](../showcase/patterns/base/README.md)
- [System of record pattern](../showcase/patterns/system-of-record/README.md)
- [Agents pattern](../showcase/patterns/agents/README.md)
- [Host plugin pattern](../showcase/patterns/host-plugin/README.md)
- [Operations pattern](../showcase/patterns/operations/README.md)
- [Review pattern](../showcase/patterns/review/README.md)
- [Signals pattern](../showcase/patterns/signals/README.md)
- [Local model pattern](../showcase/patterns/local-model/README.md)
- [Sign-in pattern](../showcase/patterns/sign-in/README.md)
- [Site pattern](../showcase/patterns/site/README.md)
- [Sandbox pattern](../showcase/patterns/sandbox/README.md)
- [Hosted pattern](../showcase/patterns/hosted/README.md)
- [Architecture](architecture.md)
- [Capability authoring](capability-authoring.md)
- [Primitives](primitives.md)
- [Examples](architecture.md#examples)
- [Implementation status](implementation-status.md)
