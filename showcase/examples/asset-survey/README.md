# @agent-native/asset-survey

`asset-survey` is the hub of a field survey of an industrial or power-grid site. A manager prepares the site structure and sends surveys to paired phones or to people, who capture nameplates and equipment photos and report them back. A model or a person reads the photos, a reviewer accepts the values, and a manager files the result into the enterprise asset management system (EAM), which accepts or refuses each filing.

The phone side is [`asset-survey-field`](../asset-survey-field/README.md), a separate application that pairs with this hub. This package does not depend on it.

## Layer

Content (`showcase/examples/*`). The default extractor and the EAM are demo fakes in this package:

- [`connectors/extractor.ts`](connectors/extractor.ts) reads the text that [`connectors/nameplate-photo.ts`](connectors/nameplate-photo.ts) embeds in generated PNGs.
- [`connectors/fake-eam.ts`](connectors/fake-eam.ts) is an in-memory asset register.
- [`connectors/model-extractor.ts`](connectors/model-extractor.ts) reads photos with a vision model instead, when explicitly configured.

[`fixtures/nameplates`](fixtures/nameplates.ts) holds six generated photos of nameplates by fictional manufacturers: a motor, pump, transformer, breaker, valve and compressor. `ground-truth.json` records what each photo shows. The valve's serial and the compressor's model and power are hard to read on purpose. Each photo carries its values as a JPEG comment, which the demo extractor reads.

## Primitives

The example is one [application](../../../docs/primitives.md#application). It composes:

- two [assignment](../../../docs/primitives.md#assignment) kinds in [`contracts/kinds.ts`](contracts/kinds.ts), mounted with the `assignment` feature:
  - `survey`: the scope is a set of subtrees and capture kinds, the brief is that slice of the structure, and each report is one capture about a node. Its lanes are device and person.
  - `extraction`: the scope is one capture, the brief is its photos, and the report is the values read with a confidence each. Its lanes are the `model` target and a person.
- the [approval](../../../docs/primitives.md#approval-request) feature for `structure.node.create`, so an agent requests nodes and a manager approves them.
- three [modules](../../../docs/primitives.md#module) in [`contracts.ts`](contracts.ts): structure and documents, review, and filing. Each carries a workflow text for agents.
- [collections](../../../docs/primitives.md#collection) for nodes and documents, with generated writes and the node tree. Hooks in `handlers/structure.ts` normalize and check designations.
- [blob references](../../../docs/primitives.md#blob-store): captures and documents carry photos and files as `BlobRef`s with declared limits. Extraction briefs and filings attach the photos they send, so the connectors can read them.
- three [targets](../../../docs/primitives.md#target), wired with `connectTarget`. The assignment feature owns `assignment-model`, which sends extraction offers through the [outbox](../../../docs/glossary.md#outbox) and takes readings back through its feed. `eam` sends filings and returns asset snapshots, and `export` sends filings as folders with no feed.
- a [data provider](../../../docs/primitives.md#data-provider), `eam.asset`, for live EAM search and lookup with the integration's service account.
- [requirement declarations](../../../docs/primitives.md#requirement-declaration) for the `model-api` (internet) and `eam-api` (site) destinations, both `offline: 'queue'`. The optional `filing-export` process carries the `export` target.
- the `site`, `network`, `process`, `audit`, `compliance`, `device-link` and `workflows` [host plugins](../../../docs/primitives.md#host-plugin). Device link pairs phones and authenticates them as `device:<id>`. The application passes `FIELD_SYNC_OPERATIONS`, the device lane of the assignments, as its default grant.
- a peer surface, `hubSurface` in [`contracts/peer.ts`](contracts/peer.ts), listing the device lane: `assignment.survey.report`, `assignment.complete` and `assignment.feed`. The field application's [worklist](../../../docs/primitives.md#worklist) declares the hub as a [peer target](../../../docs/primitives.md#peer-target) through it and checks the hub's served contract against it.
- [capability bindings](../../../docs/primitives.md#capability-binding) on every screen, and a `compact` variant of the review queue for tablets.

The structure names nodes by reference designations: IEC 81346, KKS and ANSI/IEEE C37.2 device numbers. The scheme tables in [`contracts/schemes.ts`](contracts/schemes.ts) hold the common class letters and device numbers, not the full standards.

`bun run generate` writes the capability reference to `dist/reference/asset-survey/operations.md`.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/asset-survey/manifest` | browser and server | Default export: `defineManifest` with ID `asset-survey`, its modules, the assignment and approval features and the plugins. |
| `@agent-native/asset-survey/application` | server only | Default export: the hub with the demo extractor and EAM. |
| `@agent-native/asset-survey/screens` | browser | Default export: `defineScreens` with Structure (home), node detail, Documents, Assignments, survey detail, Review, capture detail, reading, Filing, My work and plugin screens. |
| `@agent-native/asset-survey/*` | see file | `contracts` and `contracts/*` (browser-safe, shared with the field application), `domain`, `migration`, `policy`, `server`, `connectors/*`. |

`createAssetSurveyApplication` takes another extractor, or a factory given the network port. It also takes another EAM port, services or members.

### Commands

| Command (in this directory) | Purpose |
| --- | --- |
| `bun run dev` | Desktop window on port 4326 with the demo extractor and EAM. |
| `bun run dev:web` | Browser on port 4326 with the demo extractor and EAM. |

To run it from the repository root, set `AGENT_NATIVE_APPLICATION=@agent-native/asset-survey`.

For live extraction:

- set `ASSET_SURVEY_MODEL` to a vision model's ID;
- set `ASSET_SURVEY_MODEL_API_KEY` to its key;
- bind `model-api` in the deployment policy to an OpenAI-compatible chat completions base URL, such as `https://api.openai.com/v1`. The destination is declared `https`, so the site check refuses a plain `http` URL off this machine, and warns for one on loopback, such as a local server's.

The application reads nothing else: no other variable, key store or provider login.

The demo EAM holds `EAM-1001` (`=G1-Q1`, active, with a serial) and `EAM-1002` (`=G1-F2`, retired). It refuses to create an asset without a serial or with the designation of an active asset.

## Trust boundary

Roles are per member:

- managers edit the structure, plan and send surveys, approve requested nodes and file;
- reviewers take survey work, place, discard and accept captures, and send captures to be read;
- viewers read.

`surveyAccess` in `policy.ts` is the assignment feature's view of these roles. A survey or extraction sent to a person is refused unless that person is a member who is not a viewer. Accepting a reading, a capture or a requested node requires a person. An agent run under a [delegated grant](../../../docs/glossary.md#grant) may prepare the review, but its accept is refused.

A paired device (`device:<id>`) may read its own feed, report captures on surveys sent to it and mark them done. It may do nothing else: no structure query and no journal events. The [device link](../../../docs/glossary.md#device-link) grant limits it to `FIELD_SYNC_OPERATIONS`, and the assignment feature matches the device to the survey's assignee. Revoking the device refuses its next request.

A capture names its node, and the hub decides whether the survey covers it. A node outside the survey's subtrees reaches the hub unplaced when a device reports it, and a person on the hub is refused. Placing a capture is limited to nodes its survey covers.

The [integration principal](../../../docs/glossary.md#integration-principal) settles and syncs the `assignment-model`, `eam` and `export` targets only. A reading never writes attributes. An EAM snapshot only updates `assetStatus` of nodes filed as that asset.

The model's answer is untrusted input. The model extractor keeps only values under valid attribute names, from photos of the request, with confidence and regions clamped. Every value is a proposal that a person accepts or corrects. The extractor's requests reach only the `model-api` [destination](../../../docs/glossary.md#destination) through the network port. The deployment policy decides the endpoint, and a request elsewhere fails.

The export directory belongs to the site. The deployment policy binds `filing-export` to an executable and its arguments. The reference [`export/worker.ts`](export/worker.ts) takes the directory as its last argument, for example `{ "executable": "/usr/local/bin/bun", "args": ["<repo>/examples/asset-survey/export/worker.ts", "/srv/survey-export"] }`. The worker:

- accepts one path segment as the folder name;
- writes only photos whose bytes match their digest;
- assembles the folder under a temporary name and renames it into place;
- answers a folder that already holds the same effect as written.

When `filing-export` is unbound or the worker fails, the filing stays pending and is retried. The connector records a fixed message, never the worker's output.

Photos are readable by whoever may read a capture, extraction or filing that references them. Photos of captures adopted from version 1 stay attached to `capture:<id>`, which every member may read. The extractor and the EAM read photos through `readEffectBlob`, scoped to the [effect](../../../docs/glossary.md#effect) being delivered. The demo EAM's credentials are a service-account string in memory. A deploying application backs `CallerCredentials` with its [credential vault](../../../docs/glossary.md#credential-vault).

## Dependencies

Framework and plugins: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/integration`, `@agent-native/assignments`, `@agent-native/react`, `@agent-native/frame`, `@agent-native/site`, `@agent-native/network`, `@agent-native/process`, `@agent-native/audit`, `@agent-native/compliance`, `@agent-native/device-link` and `@agent-native/workflows`. The tests also use `@agent-native/client`, `@agent-native/adapters`, `@agent-native/kernel` and `@agent-native/testing`.

Screens use the frame's session and shadcn components through the `@/` alias, including the `collection-tree`, `approval-review`, `assignment-board`, `assignment-reports` and `my-assignments` registry components. External: `zod`, `ai` and `@ai-sdk/openai` (the model extractor), `react`, `@tanstack/react-query`, `@tanstack/react-router` and `lucide-react`.

## Tests

```sh
bun test showcase/examples/asset-survey/
bunx playwright test showcase/examples/asset-survey/e2e
```

- `test/application.test.ts`:
  - designations are validated per scheme and unique among active nodes; a move under a descendant and retiring a parent are refused;
  - an agent requests a node and only a manager approves it;
  - a survey's feed reaches only its device, with a content cursor;
  - a report is idempotent by ID, a node outside the survey arrives unplaced, and placing is limited to the survey;
  - the model's reading flags values, acceptance records edits, and the node is filed into the EAM;
  - a person takes a survey at the desk and reads a capture by hand;
  - a filing waits while the EAM is down;
  - outsiders, viewers and the integration principal are refused.
- `test/migration.test.ts`:
  - a version 1 workspace opens with its assignments as surveys, its captures as survey reports and its readings as extraction assignments; an adopted proposal is accepted onto its node, and the phone reports on the adopted survey;
  - a version 1 workspace with requested nodes or readings in flight is refused unchanged.
- `test/export.test.ts`:
  - an unbound export waits while the EAM filing of the same node goes out, and a second export of the node conflicts;
  - bound through a deployment policy, the process writes one folder with the record and photos that match their digests, and the filing names it;
  - the worker answers a repeated effect as written;
  - the worker refuses another effect for the same folder, a photo that does not match its digest and a folder outside the directory.
- `test/model-extractor.test.ts`:
  - against a mock model, every photo goes out in one structured call;
  - malformed names, empty values and unknown photo numbers are dropped, confidence and regions are clamped, and the more confident of two values is kept;
  - configured from the environment, the extractor does nothing without `ASSET_SURVEY_MODEL` and ignores an ambient `OPENAI_API_KEY`;
  - the one request goes to `model-api` with the configured key.
- `test/nameplates.test.ts`: the demo extractor reads each sample photo as its ground truth. It doubts the values marked hard to read and gives no region. The text rides in a JPEG comment and leaves the image data alone.
- `test/conformance.test.ts`:
  - a device paired through the enrollment route reads its feed, uploads a photo and reports a capture over HTTP with its own token;
  - the same device is refused elsewhere;
  - the capture reads the same directly, over HTTP, the CLI and MCP;
  - MCP marks EAM search read-only and filing open-world.
- `test/place-and-extract.test.ts`: `capture.place-and-extract` places a capture and sends it to the model in one commit on every surface, and rolls back with a grant that lacks the extraction.
- `test/capture-to-eam.test.ts`, with the runner driven one pass at a time on a test clock:
  - `survey.capture-to-eam` places the capture, waits for the review, files the node into the EAM and exports it;
  - a refused export withdraws the EAM filing, which retires the created asset and clears the node's asset ID;
  - a cancel during the wait stops the instance;
  - a review not done within a week fails the instance.
- `test/ui-bindings.test.ts`: every capability that claims a UI binding is referenced by a screen.
- `e2e/survey.pw.ts`, in Chromium:
  - build the structure, with a refused designation shown inline;
  - pair a phone, create and send a survey, and receive a capture;
  - upload the valve sample photo and read it with the model;
  - correct the doubted serial, accept it and create the asset in the EAM;
  - start an export that waits with no process bound;
  - show the review queue's compact variant at tablet width.

`test/live-extraction.test.ts` reads the six sample plates with a real model. It prints how the model's reading compares with the ground truth. It runs only with `ASSET_SURVEY_MODEL` and `ASSET_SURVEY_MODEL_URL` set, plus `ASSET_SURVEY_MODEL_API_KEY` for a hosted provider. Its result is recorded in the [implementation status](../../../docs/implementation-status.md).

```sh
ASSET_SURVEY_MODEL=<model> ASSET_SURVEY_MODEL_URL=https://api.openai.com/v1 ASSET_SURVEY_MODEL_API_KEY=<key> \
  bun test showcase/examples/asset-survey/test/live-extraction.test.ts
```

## Demonstrated mechanisms

Paths are relative to `showcase/examples/asset-survey`.

| Mechanism | Code | Proof |
| --- | --- | --- |
| [Application](../../../docs/primitives.md#application) with three entrypoints | `manifest.ts`, `application.ts` (`createAssetSurveyApplication`), `screens.tsx` | `test/conformance.test.ts` |
| [Assignments](../../../docs/primitives.md#assignment) with two kinds and per-kind hooks | `contracts/kinds.ts`; `surveyHooks` in `handlers/survey.ts`; `surveyAccess` in `policy.ts`; `assignmentFeature` in `application.ts` | `test/application.test.ts` |
| Adoption of version 1 records into a feature | `adoptAssignments` and `migrations` in `migration.ts`; `adopt` in `application.ts` | `test/migration.test.ts` |
| [Approval requests](../../../docs/primitives.md#approval-request) for node creation | `approvalFeature` in `application.ts`; `proposalAccess` in `policy.ts` | `test/application.test.ts`, "an agent requests a node" |
| [Modules](../../../docs/primitives.md#module) with workflow text for agents | `contracts.ts` (`structureModule`, `reviewModule`, `filingModule`) | The workflow reference check in `packages/contracts/test/contracts.test.ts`, "duplicate IDs, dependencies, cycles, workflow references" |
| [Collections](../../../docs/primitives.md#collection) with generated writes and a tree | `contracts/structure.ts`; `collectionCommandHandlers` and `collectionTreeHandler` in `handlers/structure.ts` | `test/application.test.ts` |
| [Policy](../../../docs/primitives.md#policy) with roles, person-only rules and integration lanes | `policy.ts` (`surveyPolicy`) | `test/application.test.ts`, "outsiders and the integration principal" |
| [Blob store](../../../docs/primitives.md#blob-store): attach and connector reads | `blobs` limits in `contracts/kinds.ts` and `contracts/structure.ts`; `ctx.attach` in `handlers/filing.ts`; `readBlob` in `connectors/extractor.ts` | `test/conformance.test.ts`, `test/export.test.ts`; no test exercises the `photoLimits` size and type limits |
| [Outbox effects](../../../docs/primitives.md#outbox-effect) on three [targets](../../../docs/primitives.md#target) | the `model` target lane in `contracts/kinds.ts`; `eamTarget` and `exportTarget` in `contracts/filing.ts` | `test/application.test.ts`, "the model reads a capture"; `test/export.test.ts` |
| Settle, sync and status handlers | generated by the assignment feature for `assignment-model`; `targetHandlers` and `settleDelivery` in `handlers/filing.ts` | `test/application.test.ts` |
| [Dispatcher](../../../docs/primitives.md#dispatcher) retry on a transient failure | `connectTarget` in `application.ts`; `DeliveryFailure` in `connectors/fake-eam.ts` | `test/application.test.ts`, "a filing waits while the EAM is unreachable" |
| [Inbound sync](../../../docs/primitives.md#inbound-sync) from two feeds | `assignmentTargetPort` in `connectors/extractor.ts`; `pull` in `connectors/fake-eam.ts` | `test/application.test.ts` |
| [Connectors](../../../docs/primitives.md#connector) as `SystemOfRecordPort` | `createExtractionPort`, `FakeEam`, `createExportPort` | `test/application.test.ts`, `test/export.test.ts` |
| [Data provider](../../../docs/primitives.md#data-provider) and [remote query](../../../docs/primitives.md#remote-query) | `eamAssets` in `contracts/filing.ts`, `implementDataProvider` in `handlers/filing.ts`, `createRemoteSource` in `application.ts` | `test/application.test.ts`; MCP read-only hint in `test/conformance.test.ts` |
| [Requirement declarations](../../../docs/primitives.md#requirement-declaration) for two destinations and a process | `requirements` in `contracts.ts` | `test/export.test.ts`, "a bound export writes one folder"; the destinations are checked only by `site check` |
| Model calls through the network port | `modelApiFetch` and `modelExtractorFromEnv` in `connectors/model-extractor.ts` | `test/model-extractor.test.ts`, "live extraction is configured only explicitly", with a hand-written network port; no example test runs the [egress guard](../../../docs/primitives.md#egress-guard) |
| [Process port](../../../docs/primitives.md#process-port) behind a target | `bunProcesses` in `application.ts`; `export/connector.ts`, `export/worker.ts` | `test/export.test.ts` |
| [Device link](../../../docs/primitives.md#device-link) with a sync grant | `createDeviceLinkPlugin({ syncOperations })` in `application.ts` | `test/conformance.test.ts`; `test/application.test.ts`, "a survey's feed reaches only its device" |
| [Nested invocation](../../../docs/glossary.md#nested-invocation) of feature operations | `placeAndExtract` in `handlers/survey.ts`; the extraction `accept` hook | `test/place-and-extract.test.ts` |
| [UI session context](../../../docs/primitives.md#ui-session-context) selections | `selectableResources` in `application.ts` | No example test covers it |
| [Surface adapters](../../../docs/primitives.md#surface-adapter): HTTP, CLI and MCP | Generated from the catalog | `test/conformance.test.ts` |
| [Capability bindings](../../../docs/primitives.md#capability-binding) and [live queries](../../../docs/primitives.md#journal-and-live-query) | `ui/*.tsx` | `test/ui-bindings.test.ts`, `e2e/survey.pw.ts` |
| Compact route variant | `review` route in `screens.tsx`, `ReviewScreenCompact` in `ui/review.tsx` | `e2e/survey.pw.ts`, "the review queue is one column" |
| [Nested invocation](../../../docs/primitives.md#nested-invocation) of two commands in one transaction | `capture.place-and-extract` in `contracts/extraction.ts` and `handlers/review.ts`; `workflow.start` from `capture.file-workflow` in `handlers/filing.ts` | `test/place-and-extract.test.ts` |
| [Workflow](../../../docs/primitives.md#workflow) with a compensation | `captureToEam` and `captureFileWorkflow` in `contracts/workflow.ts`; `filing.withdraw` in `handlers/filing.ts`; `createWorkflowsPlugin` in `application.ts` | `test/capture-to-eam.test.ts` |
| [Host plugins](../../../docs/primitives.md#host-plugin) site, network, process, audit, compliance, device-link, workflows | `manifest.ts`, `application.ts` | `test/conformance.test.ts`, `test/export.test.ts` |

## Structure

| Path | Holds |
| --- | --- |
| `manifest.ts` | The browser-safe manifest: ID `asset-survey`, the three modules, the two feature manifests and the plugin manifests. |
| `contracts.ts` | The modules, their workflow text and requirement declarations, and `operations` by short name, the assignments' included. |
| `contracts/` | The assignment kinds (`kinds.ts`), capabilities by concern, record schemas, designation schemes, the `operation` helper and the hub's peer surface (`peer.ts`). The field application imports these. |
| `domain.ts` | State shape, initial state, roles, the device principal prefix, survey scope and brief, and how a capture's reading stands. |
| `migration.ts` | `adoptAssignments`, which turns version 1 field work into the assignment slice, and the version 2 step. |
| `handlers/` | Handlers for structure, the survey's hooks and reads, and filing; `context.ts` holds collections, services and error helpers. |
| `server.ts` | `createSurveyHandlers` and the re-exports `application.ts` composes. |
| `policy.ts` | `surveyPolicy` for the application's operations, `surveyAccess` for the assignments and `proposalAccess` for node requests. |
| `application.ts` | `createAssetSurveyApplication`, `FIELD_SYNC_OPERATIONS` and `INTEGRATION_PRINCIPAL`. |
| `connectors/` | The extraction port and its demo extractor, the model extractor, the fake EAM and the nameplate photo encoder. |
| `export/` | The export connector, the process protocol and the reference `filing-export` worker. |
| `fixtures/` | Six generated nameplate JPEGs, `ground-truth.json`, and `nameplates.ts`, which loads them for the tests and the Playwright spec. |
| `screens.tsx`, `ui/` | Routes, navigation, the sidebar status and the React screens. |
| `test/`, `e2e/` | Bun tests with the `survey.ts` helper, the opt-in live extraction test, and the Playwright spec. |

## Survey and extraction flow

A reading is this example's record of the values a model or a person read from one capture. It is not an [approval request](../../../docs/primitives.md#approval-request).

1. A manager adds nodes with `structure.node.create`. The validate hook in `handlers/structure.ts` checks each designation against its scheme in `contracts/schemes.ts` and refuses one that an active node of that scheme already holds. An agent calls `approval.request` for `structure.node.create` instead, and a manager approves it.
2. `assignment.survey.create` stores the subtrees and capture kinds. With an assignee it sends the survey at once; otherwise `assignment.survey.send` sends the draft later. The `brief` hook computes the slice of active nodes below the roots when the survey is sent. The Assignments screen offers the paired devices and the members who take survey work.
3. The device reads `assignment.feed` as principal `device:<id>` and receives only its own open surveys with their briefs. The cursor is a hash of that set, so an unchanged set returns no items. A person reads the same feed on the My work screen.
4. The device uploads each photo to the blob store, then calls `assignment.survey.report` with an ID it generated. The assignment feature refuses a survey not sent to the caller and attaches the photos to the report.
5. A repeated report ID with the same body returns the first result, and a different body under that ID is `CONFLICT`. A node the survey does not cover is dropped from a device's report, so the capture arrives unplaced.
6. A reviewer sends a capture to be read with `assignment.extraction.create`, assigned to the `model` target or to a person. The `scope` hook refuses a capture already reviewed. `capture.place-and-extract` places an unplaced capture and sends it to the model in one transaction through two [nested invocations](../../../docs/glossary.md#nested-invocation), each authorized on its own.
7. Sending to the model enqueues an offer on `assignment-model` with the photos attached. The dispatcher delivers it to `createExtractionPort` in `connectors/extractor.ts`, which reads the photos through `readEffectBlob`, calls the extractor and keeps the reading for inbound sync to pull. A photo it cannot read refuses the offer with `PHOTO_UNAVAILABLE`.
8. Inbound sync applies the reading as the extraction's report, and the extraction becomes done. A refused offer stays sent with its delivery rejected; a reviewer withdraws it on the Assignments screen and sends the capture again.
9. `capture.get` returns each value read with its confidence, its photo region and an attention flag below the `ATTENTION_BELOW` confidence of 0.8.
10. A person calls `assignment.extraction.accept` with the values to keep, and the feature refuses a delegated agent. The `accept` hook invokes `assignment.survey.accept`, which writes each value to the node with the capture ID and an edited flag and marks the capture accepted. A reviewer may also type values and accept the capture with `assignment.survey.accept` directly.

Each target has at most one pending filing per node. The assignment feature derives each survey's stage: sent, working once captures arrive, done when the assignee marks it done, and reviewed when no capture waits for review.

The extraction port keeps readings in memory until the hub syncs them. A restart in between loses the reading, and the reviewer sends the capture again.

## Filing flow

1. A member searches the EAM with `eam.asset.search`, which the runtime answers through the `eam` remote source and the EAM connector's `search`. The item mapper in `handlers/filing.ts` drops malformed records and names the node already filed as each asset.
2. `filing.file` runs `fileNode` in `handlers/filing.ts`, which refuses a node without accepted attributes or with a filing to the same target still pending.
3. `fileNode` attaches the photos of every capture an attribute came from to the filing. It enqueues `asset.update` when an asset ID is given or already on the node, and `asset.create` otherwise.
4. The dispatcher delivers the effect to `FakeEam` in `connectors/fake-eam.ts`, which reads the evidence photos through `readEffectBlob` and answers with the asset ID. A create without a serial, or with an active asset's designation, comes back as a business rejection.
5. `filing.settle` records the outcome on the filing with `settleDelivery` and, on acceptance, stores the asset ID on the node.
6. Inbound sync pulls asset changes into `filing.sync`, which updates the asset status only on nodes filed as that asset.
7. `filing.export` enqueues a `filing.export` effect for the `export` target with the record, the filer and the time.
8. `createExportPort` in `export/connector.ts` starts the `filing-export` process through the process port. It writes one request line to standard input and reads one answer line, as `export/protocol.ts` defines.
9. The worker in `export/worker.ts` checks each photo against its digest, writes the folder `<designation>_<filing>` with `record.json` and `photos/<digest>.<ext>` under a temporary name and renames it into place. The folder name becomes the filing's external reference.
10. When the site binds no `filing-export` process, the start fails. The dispatcher records a transient failure and retries the effect.
11. `filing.withdraw` undoes an accepted EAM filing with an `asset.withdraw` effect. `FakeEam` retires the asset the filing created, or restores the name, attributes and evidence an update replaced. The withdrawal is a filing of its own; a withdrawn create clears the node's asset ID, so the next filing creates an asset.

## Workflow from capture to EAM

`capture.file-workflow` starts `survey.capture-to-eam` in `contracts/workflow.ts` for an unplaced capture, as the manager who calls it, with the capture ID as its key. The workflows plugin then runs its steps:

1. `assignment.report.place` places the capture on the node.
2. `assignment.extraction.create` sends it to the model.
3. `assignment.report.get` is checked whenever a report changes, until the capture's review is `accepted`; after a week the instance fails.
4. `filing.file` files the node into the EAM and completes once the EAM accepted it.
5. `filing.export` exports the node and completes once the folder is written.

When the export is refused, the plugin runs the file step's compensation, `filing.withdraw`, and the instance ends `compensated`. The `/workflows` screen lists instances, and the "Place and file" button in `ui/capture/place-or-discard.tsx` starts one.

## Version 1 workspaces

The application's state is at version 2. A workspace written by version 1 is upgraded when it is first read:

- the `assignment` feature adopts it first with `adoptAssignments`: each assignment becomes a survey with the same ID, sent to its device, and each capture becomes a survey report with the same ID;
- an extraction the model answered becomes an extraction assignment `extraction-<capture>` with the reading as its report, and a refused one stays sent with its delivery rejected;
- the version 2 step drops the old records, the model cursor and each node's `source` and `documentId`.

The step refuses a workspace that still holds requested nodes or extractions waiting for the model. Resolve them with version 1 first. A `survey.capture-to-eam` instance started by version 1 stalls, because version 2 changed its steps. Paired phones keep their pairing and upgrade their own workspaces.

## Implementation steps

1. Run this example on port 4326 with the demo extractor and the fake EAM.

   ```sh
   cd showcase/examples/asset-survey
   bun run dev:web
   ```

2. Create the application with one of these commands, following the [create-agent-native-app skill](../../../packages/scaffold/skills/create-agent-native-app/SKILL.md). The first exports this example and the second generates an empty application, which `scaffold add` requires; both write a README whose title must stay the package name.

   ```sh
   bun run scaffold <absent-target-directory> --name <app-name> --example asset-survey
   bun run scaffold new <absent-target-directory> --name <app-name> --collection <type>
   ```

3. Change into the target directory and install its dependencies. Run every later command there, where the application sits in `showcase/examples/asset-survey` after an export and in `showcase/examples/<app-name>` in kebab case after `scaffold new`.

   ```sh
   cd <absent-target-directory>
   bun install --frozen-lockfile
   bun run generate
   ```

4. Declare the systems of record in a browser-safe `contracts/` file, following the [connect-system-of-record skill](../../../packages/integration/skills/connect-system-of-record/SKILL.md). In an application created with `scaffold new`, which already holds the first collection, add each further collection and then the target with the commands below.
   - A target per system with `defineTarget`; `eam` declares a `feed`, and `export` declares none.
   - A live search with `defineDataProvider`; `identity: 'caller-or-service'` lets a search fall back to a technical account.

   ```sh
   bun run scaffold add collection <next-type>
   bun run scaffold add target <name> --collection <type>
   ```

5. Declare the work handed out as assignment kinds with `defineAssignmentKind` and `defineAssignments`, as `contracts/kinds.ts` does, following the [assign-work skill](../../../packages/assignments/skills/assign-work/SKILL.md). A kind with a `target` lane replaces a hand-written target for a service that does the work, such as the model.
6. Declare each other capability with `defineCapability`, as `contracts/operation.ts` does, following the [add-capability skill](../../../packages/runtime/skills/add-capability/SKILL.md). In an application created with `scaffold new`, run the command below.
   - `blobs` limits on capabilities that carry photos;
   - `integration: { target, delivery: 'outbox' }` on each command that enqueues an effect for a target from step 4;
   - `ui.exception` on capabilities without a screen binding.

   ```sh
   bun run scaffold add capability <operation-id> --kind command --description "<text>"
   ```

7. Group the capabilities with `defineModule` in `contracts.ts`, adding `workflows` text for agents and these `requirements`. The catalog refuses an outbox target that no network destination, folder or process names.
   - one network destination per system, with `targets`, `reads` for a searched target and `offline: 'queue'`; a target lane is named `assignment-<lane>`;
   - one process per child program, with `targets`.

8. Write `manifest.ts` with `defineManifest` from `@agent-native/host/manifest`, listing the modules, the feature manifests and the plugin manifests. List the plugins in the order the application composes them, because `checkPlugins` in `packages/kernel/src/plugins/compose.ts` refuses a different list or order.
9. Define the state in `domain.ts`, with one cursor object per application target that has a feed. Give the fields of `Delivered` from `@agent-native/integration` to a record whose delivery outcome is its result, as `Filing` declares them inline.
10. Write the handlers:
    - `collectionCommandHandlers` and `collectionTreeHandler` for each collection, with `normalize` and `validate` hooks;
    - the assignment hooks per kind with `byKind`: `assignee`, `scope`, `brief`, `subject` and `accept`;
    - `ctx.attach` for every blob a command references, and `ctx.enqueue` for every effect;
    - `targetHandlers` with `cursor`, `onOutcome` and `status`, plus `applyBatch` for a target with a feed;
    - `implementDataProvider` with an item mapper that validates each record.
11. Write the policy with `definePolicy`, as [authorization](../../../docs/authorization.md) describes, and the feature access views:
    - `person: true` on rules a delegated agent may not pass;
    - one integration lane per principal kind;
    - `targetRules` for each target;
    - an `AssignmentAccess` that repeats the application's membership gate, because the application policy never sees feature operations.
12. Implement one connector per target, following the [connect-system-of-record skill](../../../packages/integration/skills/connect-system-of-record/SKILL.md):
    - EAM delivery and feed: `httpTargetPort` from `@agent-native/connector-http`, given `target`, `network`, `destination: 'eam-api'`, a `request` per effect, a `feed` and an `idempotencyHeader` or `lookup`. Its `request` returns a JSON body synchronously, so it sends the record without the evidence photos.
    - EAM evidence: a hand-written `SystemOfRecordPort` whose `deliver` reads each photo through `readEffectBlob`, for an EAM that must receive the photos.
    - EAM search: `createRemoteSource` takes a full `SystemOfRecordPort`, so the search port also implements `describe` and `deliver` or delegates them to the port built in `connect`. Its `search` reads the network port from a variable that `connect` sets, as `application.ts` does with `readEvidence`, and throws `DeliveryFailure` until then.
    - EAM credentials: a `CallerCredentials` the application implements, with `forPrincipal` for each person's EAM login and `service` for the technical account that `caller-or-service` allows.
    - Model lane: `assignmentTargetPort` with a `work` function, as `createExtractionPort` does; `createModelExtractor` takes an AI SDK model whose `fetch` goes through the network port, and `modelExtractorFromEnv` shows the wiring.
    - Export: `createExportPort` with any executable that speaks `export/protocol.ts`.
13. Write your own `application.ts`, because the `eam` option of `createAssetSurveyApplication` accepts only a factory that returns a `FakeEam`. Call `defineApplication` with these fields:
    - `manifest`, the default export of `manifest.ts`;
    - `createState`, `migrations` and `upgradeState`;
    - `handlers` and `authorization`, from `server.ts`;
    - `features`: `mountFeature(assignmentFeature(assignments, { targets }), { access, hooks })` and any other feature;
    - `services`, when tests inject IDs or a clock;
    - `selectableResources`, the read query for each record kind an agent run may capture;
    - `plugins`, in the manifest's order, including `createDeviceLinkPlugin({ syncOperations: assignments.lanes.device.operations })`;
    - `sources`, with `createRemoteSource` for each searched target;
    - `connect`, returning one `connectTarget` per application target and passing `application.readEffectBlob` and `bunProcesses(processes)` to the connectors.
14. Build the screens with `defineScreens`, `useCommand`, `live.liveQueryOptions` and `live.remoteQueryOptions`, following the [build-screens skill](../../../packages/frame/skills/build-screens/SKILL.md). Give a route used on tablets a `compact` component and list the plugin screens.
15. Build the phone side with the [extend-mobile-host skill](../../../packages/mobile/skills/extend-mobile-host/SKILL.md) and the [asset survey field](../asset-survey-field/README.md) page. An export of `asset-survey` leaves the field application out, and an export of `asset-survey-field` brings both.
16. Write `site/site-policy.json`, following the [deploy-to-site skill](../../../plugins/site/skills/deploy-to-site/SKILL.md). This policy uses the `site-hub` profile with TLS ingress so paired phones reach the hub, and binds `eam-api`, `model-api` and the `filing-export` process.

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

17. Keep these properties of the policy, because the check fails without them.
    - `mode` set to `connected`; without it the check reports `ISOLATED_BINDING`.
    - `grants.maxTtlSeconds`, which the `site-hub` profile requires; without it the check reports `GRANT_FLOOR`.
    - The certificate and key in `site/`, because their paths resolve against the directory of the deployment policy.
    - `https` URLs for both destinations, which are declared `https`.

18. Check the policy against the declarations of the application that `app.config.json` hosts. The output lists `eam-api` and `model-api` under `bound`, and the unbound optional destinations of the plugins and the host's model providers under `consequences`.

    ```sh
    bun run cli site check --site site/site-policy.json
    ```

19. Start a trial hub with the policy, which the site plugin reads from `AGENT_NATIVE_SITE_POLICY`. For a site, build, sign and install a bundle as the [deploy-to-site skill](../../../plugins/site/skills/deploy-to-site/SKILL.md) describes.

    The check verifies neither the ingress host nor the process paths. For a trial on one machine, set the host to `localhost`. Point the process executable and its script at paths that exist there. A host that does not resolve makes the hub exit with a report of a port in use.

    ```sh
    AGENT_NATIVE_SITE_POLICY="$PWD/site/site-policy.json" bun run dev:web
    ```

20. Write the tests as `test/survey.ts` does: open the application with `openEmbeddedInstance` and drive each target with `dispatcher.runOnce()` and `integrations.sync()`. Add a conformance test with `startHost`, a UI-binding test with `unboundOperations`, and a Playwright spec that starts the host with `startService` from `tests/e2e/service.ts`.

    ```sh
    bun test showcase/examples/<application-directory>
    bunx playwright test showcase/examples/<application-directory>/e2e
    ```

21. Run the checks and report them as the [check-a-change skill](../../../packages/testing/skills/check-a-change/SKILL.md) describes.

    ```sh
    bun run format
    bun run generate
    bun run check
    ```

## Limits

- **In-memory fakes.** The EAM is an in-memory fake, and the default extractor reads text embedded in generated photos. The model extractor has run only against a mock model and nothing against a real EAM, as the [implementation status](../../../docs/implementation-status.md) records.
- **Reading storage.** The extraction port keeps readings in memory until inbound sync pulls them, and records answered offers in memory. A restart in between loses the reading, and an offer redelivered after a restart asks the model again.
- **Asset feed.** The fake EAM's asset feed restarts empty. Asset changes after a restart are skipped until its count passes the stored watermark.
- **Refused readings.** A reading the model refused stays sent with its delivery rejected until a reviewer withdraws it. Sending the capture again creates a new extraction.
- **Device IDs.** A survey sent to a device ID that no paired device holds never reaches a phone. The assignment feature does not check pairing.
- **Feed of a manager.** A manager's own `assignment.feed` lists only work sent to that manager, which is empty unless a survey names the manager. A viewer's feed is refused.
- **Held effects.** None of the connectors reports an uncertain outcome, and the example composes no [reconciliation capabilities](../../../docs/systems-of-record.md). A replacement connector that reports uncertainty leaves effects held, with no capability here to settle or release them.
- **Roles.** Members and roles are set when a workspace is created, with the owner as the only manager by default. No capability adds a person or changes a role.
- **Agent definitions.** The three modules carry workflow text, but the example declares no agent definition and has no agent scenario.
- **Scheme tables.** `contracts/schemes.ts` labels common class letters and device numbers only. An unknown letter or number is valid syntax without a label.
- **Export directory.** The export folder has been written by the worker in `test/export.test.ts` only, not on a site.

## Skills

- [assign-work](../../../packages/assignments/skills/assign-work/SKILL.md)
- [declare-a-workflow](../../../plugins/workflows/skills/declare-a-workflow/SKILL.md)
- [connect-system-of-record](../../../packages/integration/skills/connect-system-of-record/SKILL.md)
- [extend-mobile-host](../../../packages/mobile/skills/extend-mobile-host/SKILL.md)

## References

- [Asset survey field](../asset-survey-field/README.md)
- [Assignments](../../../docs/assignments.md)
- [System-of-record pattern](../../../docs/systems-of-record.md)
- [Mobile](../../../docs/mobile.md)
- [connect-system-of-record](../../../packages/integration/skills/connect-system-of-record/SKILL.md)
- [Quality inspection](../quality-inspection/README.md)
- [CRM capture](../crm-capture/README.md)
- [Receiving](../receiving/README.md)
- [add-capability](../../../packages/runtime/skills/add-capability/SKILL.md)
- [build-screens](../../../packages/frame/skills/build-screens/SKILL.md)
