# Asset survey

The asset survey hub keeps the structure of an industrial site under reference designations and sends field assignments to paired phones. The phones return captures with photos, a model reads nameplate values from them, and a person accepts the values onto the structure. A manager then files each node into an EAM or writes it to an export directory. This page is for someone who builds a similar application on this framework, by hand or with a coding agent. The [asset survey README](README.md) describes the workspace, its entrypoints, its dependencies and its trust boundary.

The phone side is a separate application, documented in [asset survey field](../asset-survey-field/DOCUMENTATION.md). Its source imports the hub's contracts and one type from `domain.ts`, and its tests open the hub application.

## Demonstrated mechanisms

Paths are relative to `examples/asset-survey`.

| Mechanism | Code | Proof |
| --- | --- | --- |
| [Application](../../docs/primitives.md#application) with three entrypoints | `manifest.ts`, `application.ts` (`createAssetSurveyApplication`), `screens.tsx` | `test/conformance.test.ts` |
| [Modules](../../docs/primitives.md#module), three of them with workflow text for agents | `contracts.ts` (`structureModule`, `extractionModule` and `filingModule` carry workflows; `fieldModule` has none) | The workflow reference check in `packages/contracts/test/contracts.test.ts`, "duplicate IDs, dependencies, cycles, workflow references" |
| [Collections](../../docs/primitives.md#collection) through the `records` helper | `handlers/context.ts` | `test/application.test.ts` |
| [Policy](../../docs/primitives.md#policy) with roles, person-only rules and integration lanes | `policy.ts` (`surveyPolicy`) | `test/application.test.ts`, "proposed nodes wait for a person" and "outsiders and the integration principal" |
| [Blob store](../../docs/primitives.md#blob-store): attach and connector reads | `ctx.attach` in `handlers/structure.ts`, `handlers/field.ts`, `handlers/review.ts`, `handlers/filing.ts`; `readEffectBlob` in `application.ts` | `test/conformance.test.ts`, `test/export.test.ts`; no test exercises the `photoLimits` size and type limits |
| [Outbox effects](../../docs/primitives.md#outbox-effect) on three [targets](../../docs/primitives.md#target) | `contracts/extraction.ts` (`modelTarget`), `contracts/filing.ts` (`eamTarget`, `exportTarget`) | `test/application.test.ts`, "a reviewer accepts what the model read"; `test/export.test.ts` |
| Settle, sync and status handlers | `targetHandlers` in `handlers/review.ts` and `handlers/filing.ts`; `settleDelivery` in `handlers/filing.ts` | `test/application.test.ts` |
| [Dispatcher](../../docs/primitives.md#dispatcher) retry on a transient failure | `connectTarget` in `application.ts`; `DeliveryFailure` in `connectors/fake-eam.ts` | `test/application.test.ts`, "a filing waits while the EAM is unreachable" |
| [Inbound sync](../../docs/primitives.md#inbound-sync) from two feeds | `pull` in `connectors/extractor.ts` and `connectors/fake-eam.ts`; `applyBatch` in the handlers | `test/application.test.ts` |
| [Connectors](../../docs/primitives.md#connector) as `SystemOfRecordPort` | `createExtractorPort`, `FakeEam`, `createExportPort` | `test/application.test.ts`, `test/export.test.ts` |
| [Data provider](../../docs/primitives.md#data-provider) and [remote query](../../docs/primitives.md#remote-query) | `eamAssets` in `contracts/filing.ts`, `implementDataProvider` in `handlers/filing.ts`, `createRemoteSource` in `application.ts` | `test/application.test.ts`; MCP read-only hint in `test/conformance.test.ts` |
| [Requirement declarations](../../docs/primitives.md#requirement-declaration) for two destinations and a process | `requirements` in `contracts.ts` | `test/export.test.ts`, "a bound export writes one folder"; the destinations are checked only by `site check` |
| Model calls through the network port | `modelApiFetch` and `modelExtractorFromEnv` in `connectors/model-extractor.ts` | `test/model-extractor.test.ts`, "live extraction is configured only explicitly", with a hand-written network port; no example test runs the [egress guard](../../docs/primitives.md#egress-guard) |
| [Process port](../../docs/primitives.md#process-port) behind a target | `bunProcesses` in `application.ts`; `export/connector.ts`, `export/worker.ts` | `test/export.test.ts` |
| [Device link](../../docs/primitives.md#device-link) with a sync grant | `createDeviceLinkPlugin({ syncOperations })` in `application.ts`; device lane in `policy.ts` | `test/conformance.test.ts`; `test/application.test.ts`, "a dispatched assignment reaches only its device" |
| [UI session context](../../docs/primitives.md#ui-session-context) selections | `selectableResources` in `application.ts` | No example test covers it |
| [Surface adapters](../../docs/primitives.md#surface-adapter): HTTP, CLI and MCP | Generated from the catalog | `test/conformance.test.ts` |
| [Capability bindings](../../docs/primitives.md#capability-binding) and [live queries](../../docs/primitives.md#journal-and-live-query) | `ui/*.tsx` | `test/ui-bindings.test.ts`, `e2e/survey.pw.ts` |
| Compact route variant | `review` route in `screens.tsx`, `ReviewScreenCompact` in `ui/review.tsx` | `e2e/survey.pw.ts`, "the review queue is one column" |
| [Host plugins](../../docs/primitives.md#host-plugin) site, network, process, audit, compliance, device-link | `manifest.ts`, `application.ts` | `test/conformance.test.ts`, `test/export.test.ts` |

## Structure

| Path | Holds |
| --- | --- |
| `manifest.ts` | The browser-safe manifest: ID `asset-survey`, the four modules and the plugin manifests. |
| `contracts.ts` | The modules, their workflow text and requirement declarations, and `operations` by short name. |
| `contracts/` | Capabilities by concern, record schemas, designation schemes and the `operation` helper. The field application imports these. |
| `domain.ts` | State shape, initial state, roles, the device principal prefix, subtrees and the derived assignment stage. |
| `handlers/` | Handlers for structure, field work, review and filing; `context.ts` holds collections, services and error helpers. |
| `server.ts` | `createSurveyHandlers` and the re-exports `application.ts` composes. |
| `policy.ts` | `surveyPolicy`: role rules, person-only rules, the integration lane and the device lane. |
| `application.ts` | `createAssetSurveyApplication`, `FIELD_SYNC_OPERATIONS` and `INTEGRATION_PRINCIPAL`. |
| `connectors/` | The extractor connector and its demo extractor, the model extractor, the fake EAM and the nameplate photo encoder. |
| `export/` | The export connector, the process protocol and the reference `filing-export` worker. |
| `fixtures/` | Six generated nameplate JPEGs, `ground-truth.json`, and `nameplates.ts`, which loads them for the tests and the Playwright spec. |
| `screens.tsx`, `ui/` | Routes, navigation, the sidebar status and the React screens. |
| `test/`, `e2e/` | Bun tests with the `survey.ts` helper, the opt-in live extraction test, and the Playwright spec. |

## Capture and extraction flow

An extraction proposal is this example's record of the values a model read from one capture. It is not the framework's [proposal](../../docs/primitives.md#proposal).

1. A manager adds nodes with `structure.node.create` in `handlers/structure.ts`. The handler checks each designation against its scheme in `contracts/schemes.ts` and refuses one that an active node of that scheme already holds.
2. `assignment.create` stores the subtrees and capture kinds as a draft, and `assignment.dispatch` stores one device ID (`handlers/field.ts`). The Assignments screen offers the paired devices.
3. The device reads `assignment.feed` as principal `device:<id>` and receives only its own assignments, each with the active nodes below its roots and without proposed ones. The cursor is a hash of that content, so an unchanged slice returns no items.
4. The device uploads each photo to the blob store, then calls `capture.ingest` with an ID it generated. The handler refuses an assignment not dispatched to the calling device and attaches the photos to the capture.
5. A repeated capture ID with the same photos and time returns the first result, and different content under that ID is `CONFLICT`. A node outside the assignment's subtrees is dropped, so the capture arrives unplaced.
6. A reviewer calls `extraction.request` in `handlers/review.ts`. The handler attaches the capture's photos to the extraction record and enqueues an `extract` effect for the `model` target, keeping its effect ID.
7. The dispatcher delivers the effect to `createExtractorPort` in `connectors/extractor.ts`. The connector reads the photos through `readEffectBlob`, calls the extractor and keeps the extraction proposal in memory for inbound sync to pull.
8. `extraction.settle` marks the extraction failed when the connector rejects the request. Inbound sync then submits the extraction proposals to `extraction.sync`, which applies one only when its effect ID matches the open request and the extraction is not yet accepted.
9. `capture.get` returns each proposed value with its confidence, its photo region and an attention flag below the `ATTENTION_BELOW` confidence of 0.8.
10. A person calls `extraction.accept` with the values to keep, and the policy refuses a delegated agent. The handler writes each value to the node with its capture ID and an edited flag, then marks the capture reviewed.

Commands store the assignment states draft, dispatched and returned. The derived stages are in field, processed and filed, which `domain.ts` computes from captures and filings.

## Filing flow

1. A member searches the EAM with `eam.asset.search`, which the runtime answers through the `eam` remote source and the EAM connector's `search`. The item mapper in `handlers/filing.ts` drops malformed records and names the node already filed as each asset.
2. `filing.file` runs `fileNode` in `handlers/filing.ts`, which refuses a node without accepted attributes or with a filing to the same target still pending.
3. `fileNode` attaches the photos of every capture an attribute came from to the filing. It enqueues `asset.update` when an asset ID is given or already on the node, and `asset.create` otherwise.
4. The dispatcher delivers the effect to `FakeEam` in `connectors/fake-eam.ts`, which reads the evidence photos through `readEffectBlob` and answers with the asset ID. A create without a serial, or with an active asset's designation, comes back as a business rejection.
5. `filing.settle` records the outcome on the filing with `settleDelivery` and, on acceptance, stores the asset ID on the node.
6. Inbound sync pulls asset changes into `filing.sync`, which updates the asset status only on nodes filed as that asset.
7. `filing.export` enqueues a `filing.export` effect for the `export` target with the record, the filer and the time.
8. `createExportPort` in `export/connector.ts` starts the `filing-export` process through the process port. It writes one request line to standard input and reads one answer line, as `export/protocol.ts` defines.
9. The worker in `export/worker.ts` checks each photo against its digest, writes the folder under a temporary name and renames it into place. The folder name becomes the filing's external reference.
10. When the site binds no `filing-export` process, the start fails. The dispatcher records a transient failure and retries the effect.

## Implementation steps

1. Run this example on port 4326 with the demo extractor and the fake EAM.

   ```sh
   cd examples/asset-survey
   bun run dev:web
   ```

2. Create the application with one of these commands, following the [create-agent-native-app skill](../../packages/scaffold/skills/create-agent-native-app/SKILL.md). The first exports this example and the second generates an empty application, which `scaffold add` requires; both write a README whose title must stay the package name.

   ```sh
   bun run scaffold <absent-target-directory> --name <app-name> --example asset-survey
   bun run scaffold new <absent-target-directory> --name <app-name> --collection <type>
   ```

3. Change into the target directory and install its dependencies. Run every later command there, where the application sits in `examples/asset-survey` after an export and in `examples/<app-name>` in kebab case after `scaffold new`.

   ```sh
   cd <absent-target-directory>
   bun install --frozen-lockfile
   bun run generate
   ```

4. Declare the systems of record in a browser-safe `contracts/` file, following the [connect-system-of-record skill](../../packages/integration/skills/connect-system-of-record/SKILL.md). In an application created with `scaffold new`, which already holds the first collection, add each further collection and then the target with the commands below.
   - A target per system with `defineTarget`; `model` and `eam` declare a `feed`, and `export` declares none.
   - A live search with `defineDataProvider`; `identity: 'caller-or-service'` lets a search fall back to a technical account.

   ```sh
   bun run scaffold add collection <next-type>
   bun run scaffold add target <name> --collection <type>
   ```

5. Declare each capability with `defineCapability`, as `contracts/operation.ts` does, following the [add-capability skill](../../packages/runtime/skills/add-capability/SKILL.md). In an application created with `scaffold new`, run the command below.
   - `blobs` limits on capabilities that carry photos;
   - `integration: { target, delivery: 'outbox' }` on each command that enqueues an effect for a target from step 4;
   - `ui.exception` on capabilities without a screen binding.

   ```sh
   bun run scaffold add capability <operation-id> --kind command --description "<text>"
   ```

6. Group the capabilities with `defineModule` in `contracts.ts`, adding `workflows` text for agents and these `requirements`. The catalog refuses an outbox target that no network destination, folder or process names.
   - one network destination per system, with `targets`, `reads` for a searched target and `offline: 'queue'`;
   - one process per child program, with `targets`.

7. Write `manifest.ts` with `defineManifest` from `@agent-native/host/manifest`, listing the modules and the plugin manifests. List the plugins in the order the application composes them, because `checkPlugins` in `packages/kernel/src/plugins/compose.ts` refuses a different list or order.
8. Define the state in `domain.ts`, with one cursor object per target that has a feed. Give the fields of `Delivered` from `@agent-native/integration` to a record whose delivery outcome is its result, as `Filing` declares them inline.
9. Write the handlers:
   - `records` for each collection;
   - `ctx.attach` for every blob a command references, and `ctx.enqueue` for every effect;
   - `targetHandlers` with `cursor`, `onOutcome` and `status`, plus `applyBatch` for a target with a feed;
   - `settleDelivery` in `onOutcome` for a record whose delivery outcome is its result; a record whose result returns on the feed settles by hand, as `handlers/review.ts` does;
   - `implementDataProvider` with an item mapper that validates each record.
10. Write the policy with `definePolicy`, as [authorization](../../docs/authorization.md) describes:
    - `person: true` on rules a delegated agent may not pass;
    - one integration lane per principal kind, with `events: () => false` for devices;
    - `targetRules` for each target.
11. Implement one connector per target, following the [connect-system-of-record skill](../../packages/integration/skills/connect-system-of-record/SKILL.md):
    - EAM delivery and feed: `httpTargetPort` from `@agent-native/connector-http`, given `target`, `network`, `destination: 'eam-api'`, a `request` per effect, a `feed` and an `idempotencyHeader` or `lookup`. Its `request` returns a JSON body synchronously, so it sends the record without the evidence photos.
    - EAM evidence: a hand-written `SystemOfRecordPort` whose `deliver` reads each photo through `readEffectBlob`, for an EAM that must receive the photos.
    - EAM search: `createRemoteSource` takes a full `SystemOfRecordPort`, so the search port also implements `describe` and `deliver` or delegates them to the port built in `connect`. Its `search` reads the network port from a variable that `connect` sets, as `application.ts` does with `readEvidence`, and throws `DeliveryFailure` until then.
    - EAM credentials: a `CallerCredentials` the application implements, with `forPrincipal` for each person's EAM login and `service` for the technical account that `caller-or-service` allows.
    - Extractor: an `Extractor`, or `createModelExtractor` with an AI SDK model whose `fetch` goes through the network port. `modelExtractorFromEnv` shows the wiring.
    - Extractor connector: a durable replacement for `createExtractorPort` when extraction proposals must survive a restart.
    - Export: `createExportPort` with any executable that speaks `export/protocol.ts`.
12. Write your own `application.ts`, because the `eam` option of `createAssetSurveyApplication` accepts only a factory that returns a `FakeEam`. Call `defineApplication` with these fields:
    - `manifest`, the default export of `manifest.ts`;
    - `createState` and `upgradeState`, the initial state and the stored-state hook;
    - `handlers` and `authorization`, from `server.ts`;
    - `services`, when tests inject IDs or a clock;
    - `selectableResources`, the read query for each record kind an agent run may capture;
    - `plugins`, in the manifest's order, including `createDeviceLinkPlugin({ syncOperations })`;
    - `sources`, with `createRemoteSource` for each searched target;
    - `connect`, returning one `connectTarget` per target and passing `application.readEffectBlob` and `bunProcesses(processes)` to the connectors.
13. Build the screens with `defineScreens`, `useCommand`, `live.liveQueryOptions` and `live.remoteQueryOptions`, following the [build-screens skill](../../packages/frame/skills/build-screens/SKILL.md). Give a route used on tablets a `compact` component and list the plugin screens.
14. Build the phone side with the [extend-mobile-host skill](../../packages/mobile/skills/extend-mobile-host/SKILL.md) and the [asset survey field](../asset-survey-field/DOCUMENTATION.md) page. An export of `asset-survey` leaves the field application out, and an export of `asset-survey-field` brings both.
15. Write `site/site-policy.json`, following the [deploy-to-site skill](../../plugins/site/skills/deploy-to-site/SKILL.md). This policy uses the `site-hub` profile with TLS ingress so paired phones reach the hub, and binds `eam-api`, `model-api` and the `filing-export` process.

    ```json
    {
      "profile": "site-hub",
      "mode": "connected",
      "ingress": {
        "listen": "tls",
        "host": "survey-hub.plant.local",
        "port": 8443,
        "cert": "hub.pem",
        "key": "hub.key"
      },
      "grants": { "maxTtlSeconds": 3600 },
      "destinations": {
        "eam-api": { "url": "https://eam.plant.local/api", "addresses": ["10.20.0.30/32"] },
        "model-api": { "url": "https://inference.plant.local/v1", "addresses": ["10.20.0.31/32"] }
      },
      "processes": {
        "filing-export": {
          "executable": "/usr/local/bin/bun",
          "args": ["/opt/survey/examples/asset-survey/export/worker.ts", "/srv/survey-export"]
        }
      }
    }
    ```

16. Keep these properties of the policy, because the check fails without them.
    - `mode` set to `connected`; without it the check reports `ISOLATED_BINDING`.
    - `grants.maxTtlSeconds`, which the `site-hub` profile requires; without it the check reports `GRANT_FLOOR`.
    - The certificate and key in `site/`, because their paths resolve against the directory of the site policy.
    - `https` URLs for both destinations, which are declared `https`.

17. Check the policy against the declarations of the application that `app.config.json` hosts. The output lists `eam-api` and `model-api` under `bound`, and the unbound optional destinations of the plugins and the host's model providers under `consequences`.

    ```sh
    bun run cli site check --site site/site-policy.json
    ```

18. Start a trial hub with the policy, which the site plugin reads from `AGENT_NATIVE_SITE_POLICY`. For a site, build, sign and install a bundle as the [deploy-to-site skill](../../plugins/site/skills/deploy-to-site/SKILL.md) describes.

    The check verifies neither the ingress host nor the process paths. For a trial on one machine, set the host to `localhost`. Point the process executable and its script at paths that exist there. A host that does not resolve makes the hub exit with a report of a port in use.

    ```sh
    AGENT_NATIVE_SITE_POLICY="$PWD/site/site-policy.json" bun run dev:web
    ```

19. Write the tests as `test/survey.ts` does: open the application with `openEmbeddedAuthority` and drive each target with `dispatcher.runOnce()` and `integrations.sync()`. Add a conformance test with `startHost`, a UI-binding test with `unboundOperations`, and a Playwright spec that starts the host with `startService` from `tests/e2e/service.ts`.

    ```sh
    bun test examples/<application-directory>
    bunx playwright test examples/<application-directory>/e2e
    ```

20. Run the checks and report them as the [check-a-change skill](../../packages/testing/skills/check-a-change/SKILL.md) describes.

    ```sh
    bun run format
    bun run generate
    bun run check
    ```

## Limits

- **In-memory fakes.** The EAM is an in-memory fake, and the default extractor reads text embedded in generated photos. The model extractor has run only against a mock model and nothing against a real EAM, as the [implementation status](../../docs/implementation-status.md) records.
- **Proposal storage.** The extractor connector keeps extraction proposals in memory, while the workspace keeps the feed watermark across a restart. After a restart the proposal in flight is lost, and later ones are skipped until the connector's count passes the stored watermark.
- **Asset feed.** The fake EAM's asset feed also restarts empty. Asset changes after a restart are skipped until its count passes the stored watermark.
- **Answered effects.** The extractor connector records answered effects in memory. An effect redelivered after a restart asks the model again.
- **Device IDs.** `assignment.dispatch` stores any device ID without checking pairing. An assignment sent to an ID that no paired device holds never reaches a phone.
- **Held effects.** None of the connectors reports an uncertain outcome, and the example composes no [reconciliation capabilities](../../docs/system-of-record-pattern.md). A replacement connector that reports uncertainty leaves effects held, with no capability here to settle or release them.
- **Roles.** Members and roles are set when a workspace is created, with the owner as the only manager by default. No capability adds a person or changes a role.
- **State migration.** The upgrade hook in `application.ts` returns stored state unchanged, so a workspace written with an older state shape opens as it is.
- **Agent definitions.** Three of the four modules carry workflow text, but the example declares no agent definition and has no agent scenario.
- **Scheme tables.** `contracts/schemes.ts` labels common class letters and device numbers only. An unknown letter or number is valid syntax without a label.
- **Export directory.** The export folder has been written by the worker in `test/export.test.ts` only, not on a site.

## Related pages

- [Asset survey README](README.md)
- [Asset survey field](../asset-survey-field/DOCUMENTATION.md)
- [System-of-record pattern](../../docs/system-of-record-pattern.md)
- [Mobile](../../docs/mobile.md)
- [Connect-system-of-record skill](../../packages/integration/skills/connect-system-of-record/SKILL.md)
- [Quality inspection](../quality-inspection/DOCUMENTATION.md), the outbox and inbound sync with a fake quality system
- [CRM capture](../crm-capture/DOCUMENTATION.md), live search with each caller's own credential
- [Receiving](../receiving/DOCUMENTATION.md), a system of record reached through shared folders
