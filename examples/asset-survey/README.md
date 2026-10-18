# @agent-native/asset-survey

The hub of a field survey of an industrial or power-grid site. A manager prepares the site structure under reference designations (IEC 81346, KKS, ANSI/IEEE C37.2 device numbers) and sends assignments to paired phones. The phones capture nameplates and equipment photos, often offline, and hand them back. A model reads the photos, a reviewer checks and accepts the values onto the structure, and a manager files the result into the enterprise asset management system (EAM), which accepts or refuses each filing.

Technical documentation: [`DOCUMENTATION.md`](DOCUMENTATION.md).

Layer: content (`examples/*`). The default extractor and the EAM are demo fakes that live here: [`connectors/extractor.ts`](connectors/extractor.ts) reads text that [`connectors/nameplate-photo.ts`](connectors/nameplate-photo.ts) embeds in generated PNGs, and [`connectors/fake-eam.ts`](connectors/fake-eam.ts) is an in-memory asset register. [`connectors/model-extractor.ts`](connectors/model-extractor.ts) reads photos with a vision model instead, when explicitly configured. [`fixtures/nameplates`](fixtures/nameplates.ts) holds six generated photos of nameplates by fictional manufacturers (motor, pump, transformer, breaker, valve, compressor) with `ground-truth.json`, what each shows; the valve's serial and the compressor's model and power are hard to read on purpose. Each photo carries its values as a JPEG comment, which the demo extractor reads. The field app is a separate application that pairs with this hub; this package does not depend on it.

## Primitives

This example is one [Application](../../docs/primitives.md#application). It composes:

- four [modules](../../docs/primitives.md#module) in [`contracts.ts`](contracts.ts): structure and documents, field work (assignments and captures), extraction, and filing, each with a workflow text for agents;
- [blob references](../../docs/primitives.md#blob-store): captures and documents carry photos and files as `BlobRef`s with declared limits; extraction requests and filings attach the photos they send, so the connectors can read them;
- three [targets](../../docs/primitives.md#target), wired with `connectTarget`: `model` (requests go out through the outbox, proposals come back through its feed), `eam` (filings go out, asset snapshots come back) and `export` (filings go out as folders, no feed);
- a [data provider](../../docs/primitives.md#data-provider), `eam.asset`, for live EAM search and lookup with the integration's service account;
- [requirement declarations](../../docs/primitives.md#requirement-declaration) for the `model-api` (internet) and `eam-api` (site) destinations, both `offline: 'queue'`, and the optional `filing-export` process, which carries the `export` target;
- the `site`, `network`, `process`, `audit`, `compliance` and `device-link` [host plugins](../../docs/primitives.md#host-plugin). Device-link pairs phones and authenticates them as `device:<id>`; the application passes `FIELD_SYNC_OPERATIONS` as its default grant;
- [capability bindings](../../docs/primitives.md#capability-binding) on every screen, and a `compact` variant of the review queue for tablets.

`bun run generate` writes the operation reference to `dist/reference/asset-survey/operations.md`.

## Entrypoints

| Import                                   | Runs in            | Contents                                                                                                                                               |
| ---------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@agent-native/asset-survey/manifest`    | browser and server | Default export: `defineManifest` with id `asset-survey`, its modules and plugins.                                                                     |
| `@agent-native/asset-survey/application` | server only        | Default export: the hub with the demo extractor and EAM. `createAssetSurveyApplication` takes another extractor (or a factory given the network port), EAM port, services or members.      |
| `@agent-native/asset-survey/screens`     | browser            | Default export: `defineScreens` with Structure (home), node detail, Documents, Assignments, Review, capture detail and Filing, plus the plugin screens. |
| `@agent-native/asset-survey/*`           | see file           | Other modules by name: `contracts` and `contracts/*` (browser-safe, shared with the field app), `domain`, `policy`, `server`, `connectors/*`.           |

Handlers are grouped by concern in `handlers/`: `structure` (nodes, designations, documents), `field` (assignments, the device feed, ingest, placing and discarding captures), `review` (extraction requests, acceptance, the model target) and `filing` (the EAM provider, filing, export, and the EAM and export targets). They share `handlers/context`.

How a capture moves:

1. `assignment.create` names subtrees and capture kinds; `assignment.dispatch` sends it to one paired device.
2. The device reads `assignment.feed`: its assignments with the structure slice below each root. The cursor is a digest of the content, so it changes exactly when the slice does.
3. The device uploads photos and calls `capture.ingest` with an ID it generated. The same capture delivered again is accepted once; a different capture under that ID is a `CONFLICT`. A node outside the assignment (retired since the device synced) arrives unplaced.
4. `extraction.request` enqueues the photos to `model`. The proposal returns through the model's feed with a confidence and photo region per value; values below 0.8 are flagged.
5. `extraction.accept` writes the reviewer's values to the node, each with its capture and whether the reviewer changed it. Only a person may accept.
6. `filing.file` sends the node's attributes and the photos they came from to `eam`, updating an asset by ID or creating one. The EAM's outcome names the asset; its feed reports later changes such as retirement.
7. `filing.export` sends the same record to `export` instead, for a system that imports files. The `filing-export` process writes it as a folder `<designation>_<filing>` with `record.json` and `photos/<digest>.<ext>`; the folder name is the filing's reference. Each target has at most one pending filing per node.

The assignment's stage (`in-field`, `processed`, `filed`) follows from its captures and filings, so no command moves it.

| Command (in this directory)       | Purpose                                                              |
| --------------------------------- | -------------------------------------------------------------------- |
| `bun run dev` / `bun run dev:web` | Desktop window or browser on port 4326 with the demo extractor and EAM. |

Run it from the root with `AGENT_NATIVE_APPLICATION=@agent-native/asset-survey`. For live extraction, set `ASSET_SURVEY_MODEL` to a vision model's ID and `ASSET_SURVEY_MODEL_API_KEY` to its key, and bind `model-api` in the site policy to an OpenAI-compatible chat completions base URL, such as `https://api.openai.com/v1` or a local server's `http://127.0.0.1:11434/v1`. Nothing else is read: no other variable, key store or provider login. The demo EAM holds `EAM-1001` (`=G1-Q1`, active, with a serial) and `EAM-1002` (`=G1-F2`, retired). It refuses to create an asset without a serial or with the designation of an active asset.

Known limits: the extractor port keeps proposals in memory until the hub syncs them, so a restart in between loses the proposal and the reviewer requests it again. The scheme tables in [`contracts/schemes.ts`](contracts/schemes.ts) hold the common class letters and device numbers, not the full standards.

## Trust boundary

Roles are per member: managers edit the structure, plan and dispatch assignments and file; reviewers place, discard and request extractions and accept them; viewers read. Accepting a proposed node or extracted values requires a person; a delegated agent may prepare the review but its accept is refused. Agents propose nodes (`structure.node.propose`); a manager accepts them.

A paired device (`device:<id>`) may read its own feed, return its own assignments and ingest captures into them, and nothing else: no structure query, no journal events. The device-link grant limits it to `FIELD_SYNC_OPERATIONS` and the policy's device lane enforces the same list. Ingest checks that the assignment was dispatched to the calling device. Revoking the device refuses its next request.

The integration principal settles and syncs the `model`, `eam` and `export` targets only. A proposal never writes attributes and an EAM snapshot only updates `assetStatus` of nodes filed as that asset.

The model's answer is untrusted input: the model extractor keeps only values under valid attribute names, from photos of the request, with confidence and regions clamped; every value is a proposal a person accepts or corrects. Its requests reach only the `model-api` destination through the network port, so the site policy decides the endpoint and a request elsewhere fails.

The export directory is the site's: the policy binds `filing-export` to an executable and its arguments, and the reference [`export/worker.ts`](export/worker.ts) takes the directory as its last argument, for example `{ "executable": "/usr/local/bin/bun", "args": ["<repo>/examples/asset-survey/export/worker.ts", "/srv/survey-export"] }`. The worker accepts one path segment as the folder name, writes only photos whose bytes match their digest, assembles the folder under a temporary name and renames it into place, and answers a folder that already holds the same effect as written. Unbound, or when the worker fails, the filing stays pending and is retried; the connector records a fixed message, never the worker's output.

Photos are readable by whoever may read a capture, extraction request or filing that references them. The extractor and EAM read them through `readEffectBlob`, scoped to the effect being delivered. The demo EAM's credentials are a service-account string in memory; a deploying application backs `CallerCredentials` with its vault.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/integration`, `@agent-native/react`, `@agent-native/frame`, `@agent-native/site`, `@agent-native/network`, `@agent-native/process`, `@agent-native/audit`, `@agent-native/compliance`, `@agent-native/device-link`, and `@agent-native/client`, `@agent-native/adapters` and `@agent-native/testing` (tests). Screens use the frame's session and shadcn components through the `@/` alias. External: `zod`, `ai` and `@ai-sdk/openai` (the model extractor), `react`, `@tanstack/react-query`, `@tanstack/react-router`, `lucide-react`.

## Tests

```sh
bun test examples/asset-survey
bunx playwright test examples/asset-survey/e2e
```

| Test                       | Proves                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/application.test.ts` | Designations validated per scheme and unique among active nodes; moves under a descendant and retiring a parent refused; proposed nodes accepted only by a person; the feed scoped to its device with a content cursor; ingest idempotent by ID and refused for other devices and people; extraction with flagged values, edited acceptance, EAM refusals (duplicate designation, missing serial), an update with evidence, the EAM feed reaching the node, and a filing that waits while the EAM is down; outsiders and the integration principal refused. |
| `test/export.test.ts` | An unbound export waits while the EAM filing of the same node goes out, and a second export of the node conflicts; bound through a site policy, the process writes one folder with the record and photos that match their digests, and the filing names it; the worker answers a repeated effect as written and refuses another effect for the same folder, a photo that does not match its digest and a folder outside the directory. |
| `test/model-extractor.test.ts` | Against a mock model: every photo goes out in one structured call, and malformed names, empty values and unknown photo numbers are dropped, confidence and regions clamped, the more confident of two values kept. Configured from the environment: nothing without `ASSET_SURVEY_MODEL`, an ambient `OPENAI_API_KEY` ignored, and the one request goes to `model-api` with the configured key. |
| `test/nameplates.test.ts` | The demo extractor reads each sample photo as its ground truth, doubting the values marked hard to read and giving no region; the text rides in a JPEG comment and leaves the image data alone. |
| `test/conformance.test.ts` | A device paired through the enrollment route reads its feed, uploads a photo and ingests over HTTP with its own token and is refused elsewhere; the capture reads the same directly, over HTTP, the CLI and MCP; MCP marks EAM search read-only and filing open-world.                                                                                          |
| `test/ui-bindings.test.ts` | Every operation that claims a UI binding is referenced by a screen.                                                                                                                                                                                                                                                                                            |
| `e2e/survey.pw.ts`         | Chromium: build the structure with a refused designation shown inline, pair a phone, create and send an assignment, receive a capture, upload the valve sample photo, read it with the model, correct the doubted serial and accept it, create the asset in the EAM, and an export that waits with no process bound; the review queue's compact variant at tablet width.                                                                                 |

The fakes prove the wiring and the trust order, not a real model or EAM. `test/live-extraction.test.ts` reads the six sample plates with a real model and prints how its reading compares with the ground truth; it runs only with `ASSET_SURVEY_MODEL` and `ASSET_SURVEY_MODEL_URL` (and `ASSET_SURVEY_MODEL_API_KEY` for a hosted provider) set, and its result is recorded separately in the [implementation status](../../docs/implementation-status.md):

```sh
ASSET_SURVEY_MODEL=<model> ASSET_SURVEY_MODEL_URL=https://api.openai.com/v1 ASSET_SURVEY_MODEL_API_KEY=<key> \
  bun test examples/asset-survey/test/live-extraction.test.ts
```
