# @agent-native/asset-survey

`asset-survey` is the hub of a field survey of an industrial or power-grid site. A manager prepares the site structure and sends assignments to paired phones, which capture nameplates and equipment photos, often offline, and hand them back. A model reads the photos, a reviewer accepts the values, and a manager files the result into the enterprise asset management system (EAM), which accepts or refuses each filing.

The example demonstrates pairing with the [mobile host](../../docs/mobile.md) and delivery to a [system of record](../../docs/systems-of-record.md). The phone side is [`asset-survey-field`](../asset-survey-field/README.md), a separate application that pairs with this hub. This package does not depend on it.

## Layer

Content (`examples/*`). The default extractor and the EAM are demo fakes in this package:

- [`connectors/extractor.ts`](connectors/extractor.ts) reads the text that [`connectors/nameplate-photo.ts`](connectors/nameplate-photo.ts) embeds in generated PNGs.
- [`connectors/fake-eam.ts`](connectors/fake-eam.ts) is an in-memory asset register.
- [`connectors/model-extractor.ts`](connectors/model-extractor.ts) reads photos with a vision model instead, when explicitly configured.

[`fixtures/nameplates`](fixtures/nameplates.ts) holds six generated photos of nameplates by fictional manufacturers: a motor, pump, transformer, breaker, valve and compressor. `ground-truth.json` records what each photo shows. The valve's serial and the compressor's model and power are hard to read on purpose. Each photo carries its values as a JPEG comment, which the demo extractor reads.

## Primitives

The example is one [application](../../docs/primitives.md#application). It composes:

- four [modules](../../docs/primitives.md#module) in [`contracts.ts`](contracts.ts): structure and documents, field work (assignments and captures), extraction, and filing. Every module except field work carries a workflow text for agents.
- [blob references](../../docs/primitives.md#blob-store): captures and documents carry photos and files as `BlobRef`s with declared limits. Extraction requests and filings attach the photos they send, so the connectors can read them.
- three [targets](../../docs/primitives.md#target), wired with `connectTarget`. `model` sends requests through the [outbox](../../docs/glossary.md#outbox) and returns proposals through its feed. `eam` sends filings and returns asset snapshots, and `export` sends filings as folders with no feed.
- a [data provider](../../docs/primitives.md#data-provider), `eam.asset`, for live EAM search and lookup with the integration's service account.
- [requirement declarations](../../docs/primitives.md#requirement-declaration) for the `model-api` (internet) and `eam-api` (site) destinations, both `offline: 'queue'`. The optional `filing-export` process carries the `export` target.
- the `site`, `network`, `process`, `audit`, `compliance` and `device-link` [host plugins](../../docs/primitives.md#host-plugin). Device link pairs phones and authenticates them as `device:<id>`, and the application passes `FIELD_SYNC_OPERATIONS` as its default grant.
- [capability bindings](../../docs/primitives.md#capability-binding) on every screen, and a `compact` variant of the review queue for tablets.

The structure names nodes by reference designations: IEC 81346, KKS and ANSI/IEEE C37.2 device numbers. The scheme tables in [`contracts/schemes.ts`](contracts/schemes.ts) hold the common class letters and device numbers, not the full standards.

`bun run generate` writes the capability reference to `dist/reference/asset-survey/operations.md`.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/asset-survey/manifest` | browser and server | Default export: `defineManifest` with ID `asset-survey`, its modules and plugins. |
| `@agent-native/asset-survey/application` | server only | Default export: the hub with the demo extractor and EAM. |
| `@agent-native/asset-survey/screens` | browser | Default export: `defineScreens` with Structure (home), node detail, Documents, Assignments, Review, capture detail, Filing and plugin screens. |
| `@agent-native/asset-survey/*` | see file | `contracts` and `contracts/*` (browser-safe, shared with the field application), `domain`, `policy`, `server`, `connectors/*`. |

`createAssetSurveyApplication` takes another extractor, or a factory given the network port. It also takes another EAM port, services or members.

Handlers are grouped by concern in `handlers/` and share `handlers/context`:

- `structure`: nodes, designations and documents;
- `field`: assignments, the device feed, ingest, and placing and discarding captures;
- `review`: extraction requests, acceptance and the model target;
- `filing`: the EAM provider, filing, export, and the EAM and export targets.

### Capture flow

1. `assignment.create` names subtrees and capture kinds. `assignment.dispatch` sends the assignment to one paired device.
2. The device reads `assignment.feed`: its assignments with the structure slice below each root. The cursor is a digest of the content. It changes exactly when the slice does.
3. The device uploads photos and calls `capture.ingest` with an ID it generated. The same capture delivered again is accepted once, and a different capture under that ID is a `CONFLICT`. A capture for a node outside the assignment, such as one retired since the device synced, arrives unplaced.
4. `extraction.request` enqueues the photos to `model`. The proposal returns through the model's feed with a confidence and photo region per value. Values below 0.8 are flagged.
5. `extraction.accept` writes the reviewer's values to the node. Each value records its capture and whether the reviewer changed it. Only a person may accept.
6. `filing.file` sends the node's attributes and their source photos to `eam`, updating an asset by ID or creating one. The EAM's outcome names the asset, and its feed reports later changes such as retirement.
7. `filing.export` sends the same record to `export` instead, for a system that imports files. The `filing-export` process writes it as a folder `<designation>_<filing>` with `record.json` and `photos/<digest>.<ext>`. The folder name is the filing's reference.

Each target has at most one pending filing per node. The assignment's stage (`in-field`, `processed`, `filed`) follows from its captures and filings, so no command moves it.

The extractor port keeps proposals in memory until the hub syncs them. A restart in between loses the proposal, and the reviewer requests it again.

### Commands

| Command (in this directory) | Purpose |
| --- | --- |
| `bun run dev` | Desktop window on port 4326 with the demo extractor and EAM. |
| `bun run dev:web` | Browser on port 4326 with the demo extractor and EAM. |

To run it from the repository root, set `AGENT_NATIVE_APPLICATION=@agent-native/asset-survey`.

For live extraction:

- set `ASSET_SURVEY_MODEL` to a vision model's ID;
- set `ASSET_SURVEY_MODEL_API_KEY` to its key;
- bind `model-api` in the site policy to an OpenAI-compatible chat completions base URL, such as `https://api.openai.com/v1` or a local server's `http://127.0.0.1:11434/v1`.

The application reads nothing else: no other variable, key store or provider login.

The demo EAM holds `EAM-1001` (`=G1-Q1`, active, with a serial) and `EAM-1002` (`=G1-F2`, retired). It refuses to create an asset without a serial or with the designation of an active asset.

## Trust boundary

Roles are per member:

- managers edit the structure, plan and dispatch assignments, and file;
- reviewers place and discard captures, request extractions and accept them;
- viewers read.

Accepting a proposed node or extracted values requires a person. An agent run under a [delegated grant](../../docs/glossary.md#grant) may prepare the review, but its accept is refused. Agents propose nodes with `structure.node.propose`, and a manager accepts them.

A paired device (`device:<id>`) may read its own feed, return its own assignments and ingest captures into them. It may do nothing else: no structure query and no journal events. The [device link](../../docs/glossary.md#device-link) grant limits it to `FIELD_SYNC_OPERATIONS`, and the policy's device lane enforces the same list. Ingest checks that the assignment was dispatched to the calling device. Revoking the device refuses its next request.

The [integration principal](../../docs/glossary.md#integration-principal) settles and syncs the `model`, `eam` and `export` targets only. A proposal never writes attributes. An EAM snapshot only updates `assetStatus` of nodes filed as that asset.

The model's answer is untrusted input. The model extractor keeps only values under valid attribute names, from photos of the request, with confidence and regions clamped. Every value is a proposal that a person accepts or corrects. The extractor's requests reach only the `model-api` [destination](../../docs/glossary.md#destination) through the network port. The site policy decides the endpoint, and a request elsewhere fails.

The export directory belongs to the site. The site policy binds `filing-export` to an executable and its arguments. The reference [`export/worker.ts`](export/worker.ts) takes the directory as its last argument, for example `{ "executable": "/usr/local/bin/bun", "args": ["<repo>/examples/asset-survey/export/worker.ts", "/srv/survey-export"] }`. The worker:

- accepts one path segment as the folder name;
- writes only photos whose bytes match their digest;
- assembles the folder under a temporary name and renames it into place;
- answers a folder that already holds the same effect as written.

When `filing-export` is unbound or the worker fails, the filing stays pending and is retried. The connector records a fixed message, never the worker's output.

Photos are readable by whoever may read a capture, extraction request or filing that references them. The extractor and the EAM read them through `readEffectBlob`, scoped to the [effect](../../docs/glossary.md#effect) being delivered. The demo EAM's credentials are a service-account string in memory. A deploying application backs `CallerCredentials` with its [credential vault](../../docs/glossary.md#credential-vault).

## Dependencies

Framework and plugins: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/integration`, `@agent-native/react`, `@agent-native/frame`, `@agent-native/site`, `@agent-native/network`, `@agent-native/process`, `@agent-native/audit`, `@agent-native/compliance` and `@agent-native/device-link`. The tests also use `@agent-native/client`, `@agent-native/adapters`, `@agent-native/kernel` and `@agent-native/testing`.

Screens use the frame's session and shadcn components through the `@/` alias. External: `zod`, `ai` and `@ai-sdk/openai` (the model extractor), `react`, `@tanstack/react-query`, `@tanstack/react-router` and `lucide-react`.

## Tests

```sh
bun test examples/asset-survey
bunx playwright test examples/asset-survey/e2e
```

- `test/application.test.ts`:
  - designations are validated per scheme and unique among active nodes;
  - a move under a descendant and retiring a parent are refused;
  - only a person accepts proposed nodes;
  - the feed is scoped to its device and has a content cursor;
  - ingest is idempotent by ID and refused for other devices and for people;
  - extraction flags values, and acceptance records edits;
  - the EAM refuses a duplicate designation and a missing serial;
  - an update carries evidence, and the EAM feed reaches the node;
  - a filing waits while the EAM is down;
  - outsiders and the integration principal are refused.
- `test/export.test.ts`:
  - an unbound export waits while the EAM filing of the same node goes out, and a second export of the node conflicts;
  - bound through a site policy, the process writes one folder with the record and photos that match their digests, and the filing names it;
  - the worker answers a repeated effect as written;
  - the worker refuses another effect for the same folder, a photo that does not match its digest and a folder outside the directory.
- `test/model-extractor.test.ts`:
  - against a mock model, every photo goes out in one structured call;
  - malformed names, empty values and unknown photo numbers are dropped, confidence and regions are clamped, and the more confident of two values is kept;
  - configured from the environment, the extractor does nothing without `ASSET_SURVEY_MODEL` and ignores an ambient `OPENAI_API_KEY`;
  - the one request goes to `model-api` with the configured key.
- `test/nameplates.test.ts`: the demo extractor reads each sample photo as its ground truth. It doubts the values marked hard to read and gives no region. The text rides in a JPEG comment and leaves the image data alone.
- `test/conformance.test.ts`:
  - a device paired through the enrollment route reads its feed, uploads a photo and ingests over HTTP with its own token;
  - the same device is refused elsewhere;
  - the capture reads the same directly, over HTTP, the CLI and MCP;
  - MCP marks EAM search read-only and filing open-world.
- `test/ui-bindings.test.ts`: every capability that claims a UI binding is referenced by a screen.
- `e2e/survey.pw.ts`, in Chromium:
  - build the structure, with a refused designation shown inline;
  - pair a phone, create and send an assignment, and receive a capture;
  - upload the valve sample photo and read it with the model;
  - correct the doubted serial, accept it and create the asset in the EAM;
  - start an export that waits with no process bound;
  - show the review queue's compact variant at tablet width.

The fakes prove the wiring and the trust order. They do not prove a real model or EAM.

`test/live-extraction.test.ts` reads the six sample plates with a real model. It prints how the model's reading compares with the ground truth. It runs only with `ASSET_SURVEY_MODEL` and `ASSET_SURVEY_MODEL_URL` set, plus `ASSET_SURVEY_MODEL_API_KEY` for a hosted provider. Its result is recorded in the [implementation status](../../docs/implementation-status.md).

```sh
ASSET_SURVEY_MODEL=<model> ASSET_SURVEY_MODEL_URL=https://api.openai.com/v1 ASSET_SURVEY_MODEL_API_KEY=<key> \
  bun test examples/asset-survey/test/live-extraction.test.ts
```

## Skills

- [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md) covers the targets and the data provider.
- [extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md) covers pairing and the field application.
- [add-capability](../../packages/runtime/skills/add-capability/SKILL.md) and [build-screens](../../packages/frame/skills/build-screens/SKILL.md) cover capabilities and screens.
