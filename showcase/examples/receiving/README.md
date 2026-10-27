# @agent-native/receiving

`receiving` handles goods receiving against an ERP that is reached only through shared folders. The ERP exports advance shipping notices as CSV into an inbox folder, and each line becomes a delivery line. A receiver counts it, gives a reason when the count differs or approves the reason an agent suggests, and posts the goods receipt.

The receipt is written as one CSV file into the ERP's drop folder, and the ERP responds with a receipt file that completes it. A line the ERP marks for inspection is also sent as an inspection request to the [quality inspection](../quality-inspection/README.md) application, called as a peer, which reports the inspector's outcome back. The example demonstrates a [system of record](../../../docs/systems-of-record.md) reached through [exchange folders](../../../docs/glossary.md#exchange-folder), [approval requests](../../../docs/agents.md#approval-requests) from an agent, and another agent-native application as a target through the [peer link](../../../plugins/peer-link/README.md).

## Layer

Content (`showcase/examples/*`). It was created with `scaffold new` and extended with `scaffold add target` and `scaffold add capability`, then written by hand on those parts.

## Primitives

The example is one [application](../../../docs/primitives.md#application). It uses:

- a [collection](../../../docs/primitives.md#collection) of delivery lines, with generated reads and the default list and record screens;
- a [policy](../../../docs/primitives.md#policy) built with `definePolicy`;
- the ERP as a [target](../../../docs/primitives.md#target) whose [connector](../../../docs/primitives.md#connector) is `fileTargetPort` from [`connector-files`](../../../plugins/connector-files/README.md). It runs over three exchange folders, declared as [requirements](../../../docs/primitives.md#requirement-declaration) and bound by the [deployment policy](../../../docs/primitives.md#deployment-policy);
- an [agent definition](../../../docs/primitives.md#agent-definition), `receiving.discrepancy`, whose [approval requests](../../../docs/primitives.md#approval-request) a person approves or rejects;
- [reconciliation](../../../docs/primitives.md#reconciliation) of goods receipts the ERP left unclear, through the `reconciliation` [feature](../../../docs/primitives.md#feature) and the Held receipts screen;
- quality inspection as a [peer target](../../../docs/primitives.md#peer-target), declared from the API that application publishes and reached through the [peer link](../../../docs/primitives.md#peer-link) plugin;
- a [data provider](../../../docs/primitives.md#data-provider), `quality.lot`, that searches quality inspection's lots live as the caller's mapped person there.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/receiving/manifest` | browser and server | Default export: `defineManifest` with ID `receiving`, its module, the ERP exchange folders and the quality inspection destination. |
| `@agent-native/receiving/application` | server only | Default export: the application. |
| `@agent-native/receiving/screens` | browser | Default export: `defineScreens` with the delivery list, the line screen, approval requests, held receipts, the ERP status, the Quality screen and the Peers screen. |
| `@agent-native/receiving/*` | see file | Other modules by name: `contracts` (browser-safe), `domain`, `policy`, `server`, `erp-port`. |

`createReceivingApplication` takes services, members, an ERP port and the notice quiet period. Lines marked `// scaffold:<list>` are where `scaffold add` inserts capabilities, handlers, rules and routes.

### Commands

| Command (in this directory) | Purpose |
| --- | --- |
| `bun run dev` | Desktop window on port 4330. |
| `bun run dev:web` | Browser on port 4330. |

### Exchange folders

| Folder ID | Access | Contents |
| --- | --- | --- |
| `erp-asn` | read | Advance shipping notice exports, as CSV. |
| `erp-goods-receipts` | write | One goods receipt per posted line, as CSV named `<effect id>.csv`. |
| `erp-receipts` | read | The ERP's response per file, `<effect id>.json`, as the [connector-files README](../../../plugins/connector-files/README.md#delivery) describes. |

The notice CSV has the columns `id`, `purchaseOrder`, `supplier`, `sku`, `description` and `expected`, and an optional `inspect` column whose value `true` marks the line for incoming inspection. The goods receipt CSV has the columns `delivery`, `purchaseOrder`, `sku`, `counted`, `reason` and `note`.

The deployment policy binds each ID to a directory:

```json
{
  "folders": {
    "erp-asn": { "path": "/srv/erp-share/asn" },
    "erp-goods-receipts": { "path": "/srv/erp-share/goods-receipts" },
    "erp-receipts": { "path": "/srv/erp-share/receipts" }
  }
}
```

Until the folders are bound, no notice is imported and posted receipts wait in the [outbox](../../../docs/glossary.md#outbox). They are delivered once a restarted host finds the folders bound.

### Quality inspection

The target `quality` calls the quality inspection application through the API it publishes in `@agent-native/quality-inspection/contracts/peer`. The deployment policy binds its destination `quality-peer` to that application's address, with `https` off loopback:

```json
{
  "destinations": {
    "quality-peer": {
      "url": "https://quality.plant.example:4320",
      "addresses": ["10.20.0.15/32"],
      "ca": "site-ca.pem"
    }
  }
}
```

An administrator of quality inspection creates an enrollment code on its Peers screen, and an editor here enters it for `quality` on this application's Peers screen. Quality inspection then maps the people who search lots from here to its own people. Until the target is connected, inspection requests wait in the outbox with "connect it on the peers screen", and lot searches report it unavailable.

## Trust boundary

Only workspace members pass the policy's caller gate. Editors count, classify and post, and viewers read. The [integration principal](../../../docs/glossary.md#integration-principal) `erp-integration` holds no role and acts only in the ERP target's [integration allowlist](../../../docs/glossary.md#integration-allowlist).

The `approval` and `reconciliation` features decide their own operations over the access views in `policy.ts`, which apply the same member gate, so `erp-integration` and non-members are refused there too. Any member may request approval. The agent requests approval under the grant of the member who started it, and that grant leaves out `delivery.classify` itself. Approving runs the requested command under the approver, so only an editor's approval commits, and deciding needs a person. Only editors reject approval requests and decide held receipts.

The integration principal `quality-integration` calls only the quality target's operations. Inspection requests are created as this application's service principal there, which may only create inspection requests and read their outcomes. A lot search runs as the person the caller is mapped to in quality inspection, under that person's plant roles; the subject is the caller's principal ID, never input. A caller nobody is mapped to is refused. Lots from quality inspection are parsed before they are shown, and a malformed one is dropped.

Notice rows are input. A row that does not fit the line schema fails the import, so a malformed export is reported instead of half applied. A later export never overwrites a notice line that someone has counted.

## Dependencies

The framework packages, the site, network, audit, compliance and peer link host plugins, `@agent-native/connector-files`, and the browser-safe contracts of `@agent-native/quality-inspection`, through the root workspace. The two-host test also starts the quality inspection application.

## Tests

```sh
bun test showcase/examples/receiving
bunx playwright test showcase/examples/receiving
```

- `test/receiving.test.ts` runs an embedded instance with a deployment policy that binds the folders to temporary directories, and `FakeFileConsumer` playing the ERP. It covers:
  - notice import;
  - the agent's grant refusing a direct classification, and a viewer's approval being refused;
  - posting acknowledged before the ERP decides, and completing from the receipt;
  - an unbound drop folder holding the receipt until a restarted host binds it;
  - an unreadable receipt held until an editor says the ERP booked it, with a viewer refused;
  - a rejected receipt reopening the line;
  - corrected notices and a malformed export.
- `test/migration.test.ts` opens a workspace stored at state version 1 and finds its approval requests in the `approval` feature, once. It also refuses `erp-integration` and a non-member on approval requests and held receipts, and a viewer's rejection.
- `test/agent-scenarios.test.ts` judges the discrepancy agent with [agent scenarios](../../../docs/glossary.md#agent-scenario) on the deterministic harness. The agent requests approval for classifications and never commits them.
- `test/conformance.test.ts` imports a notice through a served host and counts over HTTP. It reads one list directly, over HTTP, the CLI and MCP.
- `test/quality-peer.test.ts` starts this application and quality inspection on loopback with `startPeerPair`, through a test gateway that the deployment policy binds `quality-peer` to. It covers:
  - sending a line marked for inspection as the peer's service principal, the request visible only to people who capture there, and the outcome coming back through the feed;
  - a lot search as the mapped person, limited to that person's plants, and an unmapped person refused;
  - an inspection request kept pending while quality inspection is down, and a lost response delivered again without a second request;
  - a request whose create command changed on quality inspection kept pending without reaching it.
- `test/ui-bindings.test.ts` checks that every bound capability is referenced by a screen.
- `e2e/receiving.pw.ts` has two tests against the real host with a deployment policy:
  - the first waits for the notice import, then counts, classifies and posts a line in the browser. The test responds as the ERP, and the ERP screen then shows the receipt accepted.
  - the second leaves the receipt unreadable and records on the Held receipts screen that the ERP booked it.

## Demonstrated mechanisms

Paths in this table are relative to the example directory, except those under `packages/`.

| Mechanism | Code | Proof |
| --- | --- | --- |
| [Scaffold](../../../docs/primitives.md#scaffold) markers | `// scaffold:<list>` lines in `contracts.ts`, `domain.ts`, `policy.ts`, `server.ts`, `application.ts`, `screens.tsx` | The scaffold's own tests on a generated application: [`packages/scaffold/src/generate.test.ts`](../../../packages/scaffold/src/generate.test.ts) |
| [Collection](../../../docs/primitives.md#collection) with generated get and list | `contracts/delivery.ts` (`deliveries`, `deliveryOperations`); `handlers/delivery.ts` | [`test/receiving.test.ts`](test/receiving.test.ts), [`test/conformance.test.ts`](test/conformance.test.ts) |
| [Policy](../../../docs/primitives.md#policy) built with `definePolicy` | `policy.ts` (`appPolicy`): caller gate, editor and person-only rules, the ERP integration allowlist | `test/receiving.test.ts`: viewer refusals on accept and resolve; every notice import passes the allowlist |
| [Target](../../../docs/primitives.md#target) for the ERP | `contracts/erp-target.ts` (`erpTarget`); `handlers/erp-target.ts` (`erpHandlers`); `application.ts` (`connectTarget`) | `test/receiving.test.ts`: the first test |
| [Outbox effect](../../../docs/primitives.md#outbox-effect) acknowledged before it is decided | `handlers/erp-target.ts` (`erp.send`, effect type `goods-receipt.post`) | `test/receiving.test.ts`: `acknowledged: 2` after the first delivery pass |
| [Connector](../../../docs/primitives.md#connector) over exchange folders | `erp-port.ts` (`erpPort`, built on `fileTargetPort`) | `test/receiving.test.ts` with `FakeFileConsumer` as the ERP |
| [Requirement declaration](../../../docs/primitives.md#requirement-declaration) of folders | `contracts/erp-target.ts` (`erpExchange`); `manifest.ts` (`components`) | Every test that opens the application; [`test/ui-bindings.test.ts`](test/ui-bindings.test.ts) builds the catalog with `manifest.components` |
| [Deployment policy](../../../docs/primitives.md#deployment-policy) folder bindings | `sitePluginManifest` in `manifest.ts`; `sitePlugin` in `application.ts` | `test/receiving.test.ts`: the unbound drop folder test; [`e2e/receiving.pw.ts`](e2e/receiving.pw.ts) |
| [Inbound sync](../../../docs/primitives.md#inbound-sync) of notices | `erp-port.ts` (`feed`); `handlers/erp-target.ts` (`applyBatch`) | `test/receiving.test.ts`: the corrected notice and malformed export test |
| [Feature](../../../docs/primitives.md#feature) mounts with access views and hooks | `manifest.ts` (`features`); `application.ts` (`mountFeature`); `policy.ts` (`approvalAccess`, `reconciliationAccess`) | [`test/migration.test.ts`](test/migration.test.ts): the refusal test |
| [State migration](../../../docs/primitives.md#state-migration) with adoption | `domain.ts` (`migrations`); `application.ts` (`adopt`) | [`test/migration.test.ts`](test/migration.test.ts): the version 1 test |
| [Reconciliation](../../../docs/primitives.md#reconciliation) of held goods receipts | `application.ts` (`reconciliationFeature`); `handlers/reconciliation.ts` (`onReceiptResolved`); `ui/reconcile.tsx` | `test/receiving.test.ts`: the unreadable receipt file test; the second test in `e2e/receiving.pw.ts` |
| [Agent definition](../../../docs/primitives.md#agent-definition) with `output: 'request-approval'` | `contracts.ts` (`receiving.discrepancy`) | [`test/agent-scenarios.test.ts`](test/agent-scenarios.test.ts) |
| [Approval request](../../../docs/primitives.md#approval-request) approved under the approver | `application.ts` (`approvalFeature`); `ui/delivery.tsx`; `ui/approvals.tsx` | `test/receiving.test.ts`: the agent grant and viewer approval checks |
| [Agent scenario](../../../docs/primitives.md#agent-scenario) on the deterministic harness | `test/agent-scenarios.test.ts` (`runAgentScenarios`) | The same file |
| [Surface adapter](../../../docs/primitives.md#surface-adapter) parity | Generated from the catalog; no example code | `test/conformance.test.ts`: instance, HTTP, CLI and MCP read one list |
| [UI registry](../../../docs/primitives.md#ui-registry) screens and [capability bindings](../../../docs/primitives.md#capability-binding) | `ui/delivery.tsx`; `ui/approvals.tsx`; `ui/reconcile.tsx` | `test/ui-bindings.test.ts`, `e2e/receiving.pw.ts` |
| [Live query](../../../docs/primitives.md#journal-and-live-query) of target status | `ui/erp-target.tsx` (`live.liveQueryOptions`) | `e2e/receiving.pw.ts`: the ERP screen shows the goods receipt accepted |
| [Peer target](../../../docs/primitives.md#peer-target) for quality inspection | `contracts/quality-peer.ts` (`qualityPeer`); `handlers/quality-peer.ts`; `application.ts` (`connectPeerTarget`, `createPeerDrift`) | [`test/quality-peer.test.ts`](test/quality-peer.test.ts) |
| [Peer link](../../../docs/primitives.md#peer-link), calling side | `manifest.ts`; `application.ts` (`createPeerLinkPlugin({ targets })`); the Peers screen | `test/quality-peer.test.ts`: every test connects with a code |
| [Data provider](../../../docs/primitives.md#data-provider) read through a peer | `contracts/quality-peer.ts` (`qualityLots`); `handlers/quality-peer.ts` (`implementDataProvider`); `application.ts` (`createPeerSource`); `ui/quality.tsx` | `test/quality-peer.test.ts`: the lot search test |

## Structure

| Path | Holds |
| --- | --- |
| `manifest.ts` | The browser-safe manifest: the module, the `erpExchange` folder declarations, the `approval` and `reconciliation` features and the site, network, audit and compliance [host plugins](../../../docs/primitives.md#host-plugin). |
| `contracts.ts` | The `operations` map, the module and the inline `receiving.discrepancy` agent definition. |
| `contracts/delivery.ts` | The delivery line schema, the `deliveries` collection, its generated reads and the receive and classify commands. |
| `contracts/erp-target.ts` | The ERP target, the notice line schema, the folder IDs, the `erpExchange` declaration and the `erp.send` command. |
| `contracts/quality-peer.ts` | The quality inspection peer target and the `quality.lot` data provider. |
| `domain.ts` | Roles, the state shape, `createState`, the state `migrations`, `upgradeState` and the `discrepant` check. |
| `policy.ts` | The policy: caller gate, editor rule, the ERP integration allowlist and event visibility; the approval and reconciliation access views. |
| `server.ts` | `createHandlers`, which lists every handler group, and the policy export. |
| `handlers/` | Delivery lines, the ERP target, the quality target with the lot search, and the reconciliation hook; `context.ts` binds handlers to the state and services. |
| `erp-port.ts` | The ERP connector: CSV encoding of goods receipts and CSV mapping of notice rows. |
| `application.ts` | `createReceivingApplication`, which mounts the features, composes plugins and connects the ERP target to the folder port. |
| `screens.tsx`, `ui/` | The screen definitions, the line screen, the approval requests, Held receipts, ERP status and Quality screens. |
| `test/`, `e2e/` | Behavioral, agent scenario, cross-surface and UI binding tests, and the Playwright spec. |

## Notice import flow

1. The ERP writes a CSV export into the folder that the deployment policy binds to `erp-asn`.
2. The target's inbound sync asks the connector in `erp-port.ts` for changes. The folder feed reads only files that have been quiet for the quiet period, which is 2 seconds unless the application's `quietMs` option sets it.
3. The feed parses each row and passes it to the example's mapping callback, which converts the expected quantity to a number. The callback validates the row against `asnLineSchema`, and a row that does not fit fails the whole pass.
4. The integration principal submits the batch as `erp.sync`. The policy admits that principal only through the ERP target's integration allowlist in `policy.ts`.
5. The target's generated sync handler refuses a batch that does not start at the stored watermark. It then applies the batch with the example's batch callback in `handlers/erp-target.ts`.
6. The batch callback inserts each new line with status `expected`. It updates a known line only while nobody has counted it, so a count is never overwritten.
7. The handler stores the new watermark and the sync time. The `erp.sync.status` query reports them on the ERP screen.

## Goods receipt flow

1. An editor records a count with `delivery.receive`. A count equal to the expected quantity clears the reason and note, and a posted line conflicts.
2. A line whose count differs from the notice needs a reason. An editor sets it with `delivery.classify`, or approves an approval request for it.
3. The agent runs under a grant built by `agentGrant`, which holds its queries and approval request submission but not the classify command. Approving an approval request runs the classify command under the approver, so the editor rule refuses a viewer.
4. An editor posts the line with `erp.send`. The handler in `handlers/erp-target.ts` refuses an uncounted line, a discrepancy without a reason, and a line whose posting is pending or accepted.
5. The handler enqueues an effect of type `goods-receipt.post` on the line's resource, in the same transaction as the line. It sets the line to posted and stores the effect ID with a pending delivery state.
6. After the commit, the [dispatcher](../../../docs/primitives.md#dispatcher) calls the connector's deliver method. The encode callback in `erp-port.ts` turns the payload into one CSV row, written as a file named after the effect ID in the drop folder.
7. The connector reports the delivery as pending, so the effect becomes acknowledged. The dispatcher then polls the connector's lookup, which reads the receipt file named after the effect ID from `erp-receipts`.
8. A receipt file that accepts or rejects the goods receipt completes the effect through `erp.effect.complete`, and the example's outcome hook records the outcome on the line. A rejection sets the line back to counted, so it can be recounted and posted again.
9. A receipt file that cannot be parsed makes the dispatcher hold the effect. The Held receipts screen lists it through `reconciliation.list`, and an editor decides it there.
10. The resolve hook in `handlers/reconciliation.ts` records an applied or refused decision on the line's posting. A not-applied decision releases the effect for another delivery, and the posting stays pending.

## Incoming inspection flow

1. `erp.send` on a line marked `inspect` also enqueues `inspection.request.create` for the `quality` target, in the posting's transaction, with the line's purchase order, supplier, SKU, description and counted quantity. Quality inspection's input schema checks the payload there, so a line it would refuse fails the post.
2. The line's inspection stays pending until the dispatcher delivers the effect as this application's service principal. Quality inspection returns an inspection request ID, which completes the inspection as accepted with that ID as `sorRef`. A line posted again after a rejected goods receipt is sent again only if quality inspection refused its request.
3. An inspector closes the request there with an outcome and a note.
4. The quality target's inbound sync reads `inspection.request.feed`, which returns only this application's requests, and `quality.sync` writes each outcome to the line whose inspection names that request.
5. The Quality screen counts inspections waiting, refused, being inspected, passed and failed through `quality.sync.status`.

## Implementation steps

The steps build an application equivalent to the example. The example itself was generated with the scaffold's new, add target and add capability commands. Its agent and reconciliation were written by hand. The steps use `add agent` for the agent, which mounts the same `approval` feature.

Run `scaffold new` from the framework checkout's root, and every later command from the new checkout's root unless a step names another directory. Steps 7 to 39 edit files, and the application typechecks again once they are all done.

1. Export the framework with a new application whose first collection is `delivery`, into a directory that is absent and outside the checkout.

   ```sh
   bun run scaffold new /absolute/path/to/goods-receiving --name receiving --display-name "Goods receiving" --collection delivery
   ```

2. Install the pinned dependencies in the new checkout, which also links the skills.

   ```sh
   cd /absolute/path/to/goods-receiving
   bun install --frozen-lockfile
   ```

3. Add the ERP target over the collection. The command writes the target's files with a fake port, and lists an `erp-api` destination as disabled in the desktop deployment policy.

   ```sh
   bun run scaffold add target erp --collection delivery
   ```

4. Add the two commands, each with an empty contract and a headless UI exception, a handler, an editor rule and a test.

   ```sh
   bun run scaffold add capability delivery.receive --kind command --description "Record the quantity counted for a delivery line. Editors only."
   bun run scaffold add capability delivery.classify --kind command --description "Give the reason a counted quantity differs from the expected one. Editors only."
   ```

5. Add the requesting agent, which the scaffold writes to `contracts/discrepancy-agent.ts`. The first agent also mounts the `approval` feature with `approvalAccess` in `policy.ts`, and adds an Approvals screen. Its agent ID is `receiving.discrepancy`.

   ```sh
   bun run scaffold add agent discrepancy --collection delivery
   ```

6. Format the generated files and generate the reference, as the scaffold's output asks after each part.

   ```sh
   bun run format
   bun run generate
   ```

7. In `contracts/discrepancy-agent.ts`, give the agent the delivery queries, the classify command, the approval request list and instructions to request approval for discrepancy reasons.
8. Move both generated commands into the collection's operations object and handler list, as the example does, and delete their generated contract and handler files. Remove their contract imports and operations-map entries from `contracts.ts`, and their handler imports and handler groups from the server entrypoint.
9. In `contracts/delivery.ts`, replace the generated item schema with the notice fields, the count, the reason, the note, the status and the import time. Set the status values to expected, counted and posted, and add a posting field that holds the effect ID and the fields of `deliveryShape`.
10. Remove the generated create and update commands from `contracts/delivery.ts`, together with their two policy rules and their two handlers. The agent stopped naming the update command in step 7, so the catalog still builds.
11. Change the list handler's order and search text in `handlers/delivery.ts` to the new fields, and rewrite the list query's description to match.
12. Define the notice line schema in `contracts/erp-target.ts` as a pick of the notice fields, and make it the target's feed item. Use its type in place of the generated `ErpItem` in the application, and in place of the local item type in the target handlers.
13. Rewrite the target's complete, sync and status descriptions for notices and goods receipts.
14. Widen the two commands in `contracts/delivery.ts` with strict input schemas and the delivery output schema. Change each permission's resource type to `Delivery`, add the delivery dependency and replace the headless exception with a UI binding.
15. Add a discrepancy check to `domain.ts` that tells whether a counted line differs from its notice. The delivery handlers and the target handlers both use it.
16. Implement the two command handlers in `handlers/delivery.ts` with the collection's record helpers, the discrepancy check and a conflict error for refused states.
17. Declare the exchange folders with `fileExchange` next to the target's declaration, and add a components list to the manifest that holds the declaration. The example uses the folder IDs `erp-asn`, `erp-goods-receipts` and `erp-receipts`, as the [connector-files README](../../../plugins/connector-files/README.md) describes.
18. Remove the generated `erp-api` entry from the module's network list and from the desktop deployment policy. A binding for a destination that nothing declares is a deployment policy error, even when the binding is disabled.
19. Rename the generated effect type to `goods-receipt.post`, and export it as a constant from the target handlers file for the port to check.
20. Replace the generated fake in `erp-port.ts` with a port factory that returns the connector's file target port. Give it a CSV drop whose encode callback writes a goods receipt as one row and rejects any other effect type.
21. Give the port factory a CSV feed and a quiet period option that it passes to the feed. The feed's mapping callback converts the expected quantity to a number, validates the row against the notice line schema and throws on a row that does not fit.
22. In the application definition, build the target's port from the connect context's folder port unless the generated `erp` option supplies one. Add a quiet period option to the application and pass it to the port factory.
23. Remove the generated `erpDeliveries` map from the state type and the initial state, together with its type import. Store the posting on the delivery line instead.
24. Rewrite the send handler in `handlers/erp-target.ts` with the posting preconditions and a goods receipt payload that holds the columns the port writes. Rewrite the send command's description to list its three refusals.
25. Rewrite the target's outcome hook, batch callback and status counts in the same file, as the example does.
26. Write `handlers/reconciliation.ts` with an `onResolved` hook that records the outcome on the line's posting.
27. List `reconciliationFeatureManifest` in the manifest's `features`, and mount `reconciliationFeature()` in `application.ts` with that hook.
28. Write `reconciliationAccess` in `policy.ts`: members list held receipts and see those on delivery lines, and editors decide them.
29. In `ui/delivery.tsx`, drop the create form from the list screen and replace the generated record screen with a line screen.
30. Put the count, reason and send forms and the approval request review on the line screen, and remove the send form from the ERP screen.
31. Add a Held receipts screen with the reconciliation review, and register its route, navigation item and capability screen prefix in `screens.tsx`.
32. Rewrite the generated conformance test on the model of `test/conformance.test.ts`. That test opens the application with a quiet period of 0, binds the notice folder, writes a notice, syncs and counts.
33. Pass the manifest's components to the UI binding test, as `test/ui-bindings.test.ts` does. Without them the catalog refuses the ERP target, which then has no declared network destination, folder or process.
34. In the generated target test, keep the case that refuses a viewer's send and a person's sync, and drop the other case. Change the file's open helper so it builds the application without the fake and without the `erp` option.
35. Replace the generated collection, capability and agent tests with a behavioral test like `test/receiving.test.ts` and agent scenarios like the example's. The generated tests use the create command or empty inputs.
36. Open the application in those tests with `openEmbeddedInstance`, a quiet period of 0 and a deployment policy setting that binds the three folders to temporary directories.
37. Play the ERP with `FakeFileConsumer` from the connector's testing entrypoint. Run each delivery pass with `runOnce` on the ERP target's dispatcher from the instance's integrations, with backoff ignored.
38. Replace the generated default screens spec with a spec like `e2e/receiving.pw.ts`. Keep the package name that the generated spec passes to `startService`, because the example's spec names the example's own package.
39. Rewrite the generated `README.md` for the new application.
40. Run the focused checks, then the full check. The [check-a-change skill](../../../packages/testing/skills/check-a-change/SKILL.md) says which to report.

    ```sh
    bun run format
    bun run generate
    bun run typecheck
    bun test showcase/examples/receiving
    bunx playwright test showcase/examples/receiving
    bun run check
    ```

41. Copy `apps/desktop/site-policy.json` and add a folders key that binds the three folders. The copy keeps the connected mode and the model provider bindings, which the discrepancy agent needs to run on a hosted model.

    ```json
    {
      "folders": {
        "erp-asn": { "path": "/srv/erp-share/asn" },
        "erp-goods-receipts": { "path": "/srv/erp-share/goods-receipts" },
        "erp-receipts": { "path": "/srv/erp-share/receipts" }
      }
    }
    ```

42. Start the application with that policy from the new checkout's root. The application also starts from its own directory, `showcase/examples/receiving`, with the same variable.

    ```sh
    AGENT_NATIVE_SITE_POLICY=/absolute/path/to/site-policy.json bun run dev
    ```

The ERP side replaces `FakeFileConsumer` and follows the rules in the [connector-files delivery section](../../../plugins/connector-files/README.md#delivery).

## Limits

- **No real ERP.** The exchange has run against temporary directories and `FakeFileConsumer` only, with no network share or mount ([implementation status](../../../docs/implementation-status.md)).
- **Model runs.** The agent scenarios have run with the deterministic harness only ([implementation status](../../../docs/implementation-status.md)).
- **Polling.** Folders are polled, and a file is read only after its quiet period, 2 seconds by default. An export is therefore imported 2 seconds after its last change at the earliest.
- **Share clock.** The feed's watermark uses the share's file times, so a file server whose clock runs behind the host can sort a new file before the watermark.
- **Malformed exports.** A row that fails the line schema fails the whole pass, so notice import stops until the ERP replaces or removes that file.
- **Counted lines.** A corrected notice does not change a line that someone has counted, so the receiver does not see a later change to `expected` on that line.
- **Repeat postings.** A posted line refuses further counts and reasons until its goods receipt is rejected, by the ERP or by a reconciliation decision.
- **Visibility.** Every member sees every line, approval request and held goods receipt, and roles apply to the whole workspace with no container scoping.
- **Integration allowlist.** No example test checks that a person is refused the ERP's sync and complete capabilities.
- **Quality inspection connection.** While `quality` is not connected, `integrations.sync()` fails at that target after the ERP has synced, so the CLI's `sync` reports an error.
- **Lot search.** Quality inspection's lot list pages by offset, so a search returns its first 50 lots only.
- **Peer runs.** The two applications have run as two hosts on one machine only, over loopback and in the peer link's TLS test ([implementation status](../../../docs/implementation-status.md)).
- **No agents marker.** The example's `contracts.ts` has no agents marker, so the scaffold cannot add an agent to it.

## Skills

- [create-agent-native-app](../../../packages/scaffold/skills/create-agent-native-app/SKILL.md)
- [connect-system-of-record](../../../packages/integration/skills/connect-system-of-record/SKILL.md)
- [connect-two-applications](../../../plugins/peer-link/skills/connect-two-applications/SKILL.md)

## References

- [System-of-record pattern](../../../docs/systems-of-record.md)
- [Connector-files README](../../../plugins/connector-files/README.md)
- [Scaffold README](../../../packages/scaffold/README.md)
- [create-agent-native-app](../../../packages/scaffold/skills/create-agent-native-app/SKILL.md)
- [connect-system-of-record](../../../packages/integration/skills/connect-system-of-record/SKILL.md)
- [Quality inspection](../quality-inspection/README.md)
- [Peer link](../../../plugins/peer-link/README.md)
- [CRM capture](../crm-capture/README.md)
- [Line station](../line-station/README.md)
- [add-capability](../../../packages/runtime/skills/add-capability/SKILL.md)
- [build-screens](../../../packages/frame/skills/build-screens/SKILL.md)
- [deploy-to-site](../../../plugins/site/skills/deploy-to-site/SKILL.md)
