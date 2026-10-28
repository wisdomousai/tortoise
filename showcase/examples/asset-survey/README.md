# Asset survey hub

A survey manager builds a site structure and sends an [assignment](../../../docs/primitives.md#assignment) to a person or a paired phone. The assignee photographs equipment and nameplates. A reviewer checks the values read from those photos, then a manager files the accepted data to an enterprise asset management system (EAM). The separate [field application](../asset-survey-field/README.md) runs on the phone and exchanges assignments and reports with this hub.

## Try the hub

From the repository root:

```sh
cd showcase/examples/asset-survey
bun run dev:web
```

The browser host listens on port 4326; `bun run dev` opens a desktop window. The default EAM is an in-memory fake. Its sample assets are `EAM-1001` (`=G1-Q1`, active) and `EAM-1002` (`=G1-F2`, retired).

The default extractor is also a fake: it reads text embedded in the demo PNGs or JPEG comments, not the photographed pixels. Six generated JPEG nameplates and their expected values are in [`fixtures/nameplates`](fixtures/nameplates.ts). A vision-model extractor is optional and needs an explicitly configured model, key and `model-api` deployment binding; see [`connectors/model-extractor.ts`](connectors/model-extractor.ts).

## From survey to asset

1. A manager creates a structure of site nodes and sends an assignment naming the relevant subtrees and capture kinds. The brief contains the active part of the structure at the time of sending.
2. A person or paired device reports captures with photos. The hub accepts only reports for assignments sent to that assignee; a device capture outside the survey's scope is kept unlinked for a reviewer.
3. A reviewer sends a capture for extraction by a person or the configured model. The result includes values and confidence. A person accepts the values to keep, which records their provenance on the node.
4. A manager files a node with accepted attributes. The application commits a filing and an outbox effect; the EAM then creates or updates the asset and returns acceptance or a business rejection. Photos accompany the filing as evidence.
5. The optional capture-to-EAM workflow links a capture, requests extraction, waits for human acceptance, files the node and exports the result. If export is refused after filing, the workflow attempts the configured filing withdrawal.

The hub's survey and extraction kinds are in [`contracts/kinds.ts`](contracts/kinds.ts); [`handlers/filing.ts`](handlers/filing.ts) handles filing, and [`contracts/workflow.ts`](contracts/workflow.ts) declares the longer workflow. The designation tables in [`contracts/schemes.ts`](contracts/schemes.ts) cover common IEC 81346, KKS and ANSI/IEEE C37.2 codes, not the full standards.

## Configuring live extraction

For an explicitly chosen vision provider, set `ASSET_SURVEY_MODEL` and `ASSET_SURVEY_MODEL_API_KEY`, then bind `model-api` to the provider's OpenAI-compatible chat-completions base URL in the deployment policy. The declaration requires HTTPS off loopback. The application does not discover provider credentials from other configuration.

## Version 1 workspaces

The application's state is at version 2. A workspace written by version 1 is upgraded when it is first read:

- the `assignment` feature adopts it first with `adoptAssignments`: each assignment becomes a survey with the same ID, sent to its device, and each capture becomes a survey report with the same ID;
- an extraction the model responded to becomes an extraction assignment `extraction-<capture>` with the reading as its report, and a refused one stays sent with its delivery rejected;
- the version 2 step drops the old records, the model cursor and each node's `source` and `documentId`.

The step refuses a workspace that still holds requested nodes or extractions waiting for the model. Resolve them with version 1 first. A `survey.capture-to-eam` instance started by version 1 stalls, because version 2 changed its steps. Paired phones keep their pairing and upgrade their own workspaces.

## Trust boundary

Roles are per member:

- managers edit the structure, plan and send surveys, approve requested nodes and file;
- reviewers take survey work, link, discard and accept captures, and send captures to be read;
- viewers read.

`surveyAccess` in `policy.ts` is the assignment feature's view of these roles. A survey or extraction sent to a person is refused unless that person is a member who is not a viewer. Accepting a reading, a capture or a requested node requires a person. An agent run under a [delegated grant](../../../docs/glossary.md#grant) may prepare the review, but its accept is refused.

A paired device (`device:<id>`) may read its own feed, report captures on surveys sent to it and mark them done. It may do nothing else: no structure query and no journal events. The [device link](../../../docs/glossary.md#device-link) grant limits it to `FIELD_SYNC_OPERATIONS`, and the assignment feature matches the device to the survey's assignee. Revoking the device refuses its next request.

A capture names its node, and the hub decides whether the survey covers it. A node outside the survey's subtrees reaches the hub unlinked when a device reports it, and a person on the hub is refused. Linking a capture is limited to nodes its survey covers.

The [integration principal](../../../docs/glossary.md#integration-principal) completes and syncs the `assignment-model`, `eam` and `export` targets only. A reading never writes attributes. An EAM snapshot only updates `assetStatus` of nodes filed as that asset.

The model's output is untrusted input. The model extractor keeps only values under valid attribute names, from photos of the request, with confidence and regions clamped. Every value is a proposal that a person accepts or corrects. The extractor's requests reach only the `model-api` [destination](../../../docs/glossary.md#destination) through the network port. The deployment policy decides the endpoint, and a request elsewhere fails.

The export directory belongs to the site. The deployment policy binds `filing-export` to an executable and its arguments. The reference [`export/worker.ts`](export/worker.ts) takes the directory as its last argument, for example `{ "executable": "/usr/local/bin/bun", "args": ["<repo>/examples/asset-survey/export/worker.ts", "/srv/survey-export"] }`. The worker:

- accepts one path segment as the folder name;
- writes only photos whose bytes match their digest;
- assembles the folder under a temporary name and renames it into place;
- reports a folder that already holds the same effect as written.

When `filing-export` is unbound or the worker fails, the filing stays pending and is retried. The connector records a fixed message, never the worker's output.

Photos are readable by whoever may read a capture, extraction or filing that references them. Photos of captures adopted from version 1 stay attached to `capture:<id>`, which every member may read. The extractor and the EAM read photos through `readEffectBlob`, scoped to the [effect](../../../docs/glossary.md#effect) being delivered. The demo EAM's credentials are a service-account string in memory. A deploying application backs `CallerCredentials` with its [credential vault](../../../docs/glossary.md#credential-vault).

## Limits

- **In-memory fakes.** The EAM is an in-memory fake, and the default extractor reads text embedded in generated photos. The model extractor has run only against a mock model and nothing against a real EAM, as the [implementation status](../../../docs/implementation-status.md) records.
- **Reading storage.** The extraction port keeps readings in memory until inbound sync pulls them, and records the offers it has responded to in memory. A restart in between loses the reading, and an offer redelivered after a restart asks the model again.
- **Asset feed.** The fake EAM's asset feed restarts empty. Asset changes after a restart are skipped until its count passes the stored watermark.
- **Refused readings.** A reading the model refused stays sent with its delivery rejected until a reviewer withdraws it. Sending the capture again creates a new extraction.
- **Device IDs.** A survey sent to a device ID that no paired device holds never reaches a phone. The assignment feature does not check pairing.
- **Feed of a manager.** A manager's own `assignment.feed` lists only work sent to that manager, which is empty unless a survey names the manager. A viewer's feed is refused.
- **Held effects.** None of the connectors reports an uncertain outcome, and the example composes no [reconciliation capabilities](../../../docs/systems-of-record.md). A replacement connector that reports uncertainty leaves effects held, with no capability here to complete or release them.
- **Roles.** Members and roles are set when a workspace is created, with the owner as the only manager by default. No capability adds a person or changes a role.
- **Agent definitions.** The three modules include workflow text, but the example declares no agent definition and has no agent scenario.
- **Scheme tables.** `contracts/schemes.ts` labels common class letters and device numbers only. An unknown letter or number is valid syntax without a label.
- **Export directory.** The export folder has been written by the worker in `test/export.test.ts` only, not on a site.

## Checks

From the repository root:

```sh
bun test showcase/examples/asset-survey
bunx playwright test showcase/examples/asset-survey/e2e
```

`test/application.test.ts` covers surveys, review and filing with fakes; `test/capture-to-eam.test.ts` drives the declared workflow on a test clock. The browser test exercises the hub and a simulated device. These checks do not establish performance of a real vision model or an EAM integration; see [implementation status](../../../docs/implementation-status.md).
