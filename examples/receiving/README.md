# @agent-native/receiving

`receiving` handles goods receiving against an ERP that is reached only through shared folders. The ERP exports advance shipping notices as CSV into an inbox folder, and each line becomes a delivery line. A receiver counts it, gives a reason when the count differs or accepts the reason an agent proposes, and posts the goods receipt.

The receipt is written as one CSV file into the ERP's drop folder, and the ERP answers with a receipt file that settles it. The example demonstrates a [system of record](../../docs/systems-of-record.md) reached through [exchange folders](../../docs/glossary.md#exchange-folder), and [proposals](../../docs/agents.md#proposals) from an agent.

## Layer

Content (`examples/*`). It was created with `scaffold new` and extended with `scaffold add target` and `scaffold add capability`, then written by hand on those parts. It has 839 lines of application source outside its tests, against 1,837 for `crm-capture`.

## Primitives

The example is one [application](../../docs/primitives.md#application). It uses:

- a [collection](../../docs/primitives.md#collection) of delivery lines, with generated reads and the default list and record screens;
- a [policy](../../docs/primitives.md#policy) built with `definePolicy`;
- the ERP as a [target](../../docs/primitives.md#target) whose [connector](../../docs/primitives.md#connector) is `fileTargetPort` from [`connector-files`](../../plugins/connector-files/README.md). It runs over three exchange folders, declared as [requirements](../../docs/primitives.md#requirement-declaration) and bound by the [site policy](../../docs/primitives.md#site-policy);
- an [agent definition](../../docs/primitives.md#agent-definition), `receiving.discrepancy`, whose [proposals](../../docs/primitives.md#proposal) a person accepts or rejects;
- [reconciliation](../../docs/primitives.md#reconciliation) of goods receipts the ERP left unclear, through `reconciliationOperations` and the Held receipts screen.

The manifest and the application list the `site`, `network`, `audit` and `compliance` [host plugins](../../docs/primitives.md#host-plugin). The screens compose the compliance plugin's screens.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/receiving/manifest` | browser and server | Default export: `defineManifest` with ID `receiving`, its module and the ERP exchange folders. |
| `@agent-native/receiving/application` | server only | Default export: the application. |
| `@agent-native/receiving/screens` | browser | Default export: `defineScreens` with the delivery list, the line screen, proposals, held receipts and the ERP status. |
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
| `erp-receipts` | read | The ERP's answer per file, `<effect id>.json`, as the [connector-files README](../../plugins/connector-files/README.md#delivery) describes. |

The notice CSV has the columns `id`, `purchaseOrder`, `supplier`, `sku`, `description` and `expected`. The goods receipt CSV has the columns `delivery`, `purchaseOrder`, `sku`, `counted`, `reason` and `note`.

The site policy binds each ID to a directory:

```json
{
  "folders": {
    "erp-asn": { "path": "/srv/erp-share/asn" },
    "erp-goods-receipts": { "path": "/srv/erp-share/goods-receipts" },
    "erp-receipts": { "path": "/srv/erp-share/receipts" }
  }
}
```

Until the folders are bound, no notice is imported and posted receipts wait in the [outbox](../../docs/glossary.md#outbox). They are delivered once a restarted host finds the folders bound.

## Trust boundary

Only workspace members pass the policy's caller gate. Editors count, classify and post, and viewers read. The [integration principal](../../docs/glossary.md#integration-principal) `erp-integration` holds no role and acts only in the ERP target's [policy lane](../../docs/glossary.md#policy-lane).

Any member may propose. The agent proposes under the grant of the member who started it, and that grant leaves out `delivery.classify` itself. Accepting runs the proposed command under the accepter, so only an editor's acceptance commits, and deciding needs a person.

Notice rows are input. A row that does not fit the line schema fails the import, so a malformed export is reported instead of half applied. A later export never overwrites a notice line that someone has counted.

## Dependencies

The framework packages, the four host plugins and `@agent-native/connector-files`, through the root workspace.

## Tests

```sh
bun test examples/receiving
bunx playwright test examples/receiving
```

- `test/receiving.test.ts` runs an embedded instance with a site policy that binds the folders to temporary directories, and `FakeFileConsumer` playing the ERP. It covers:
  - notice import;
  - the agent's grant refusing a direct classification, and a viewer's acceptance being refused;
  - posting with a pending upstream, and settling from the receipt;
  - an unbound drop folder holding the receipt until a restarted host binds it;
  - an unreadable receipt held until an editor says the ERP booked it, with a viewer refused;
  - a rejected receipt reopening the line;
  - corrected notices and a malformed export.
- `test/agent-scenarios.test.ts` judges the discrepancy agent with [agent scenarios](../../docs/glossary.md#agent-scenario) on the deterministic harness. The agent proposes classifications and never commits them.
- `test/conformance.test.ts` imports a notice through a served host and counts over HTTP. It reads one list directly, over HTTP, the CLI and MCP.
- `test/ui-bindings.test.ts` checks that every bound capability is referenced by a screen.
- `e2e/receiving.pw.ts` has two tests against the real host with a site policy:
  - the first waits for the notice import, then counts, classifies and posts a line in the browser. The test answers as the ERP, and the ERP screen then shows the receipt accepted.
  - the second leaves the receipt unreadable and records on the Held receipts screen that the ERP booked it.

## Demonstrated mechanisms

Paths in this table are relative to the example directory, except those under `packages/`.

| Mechanism | Code | Proof |
| --- | --- | --- |
| [Scaffold](../../docs/primitives.md#scaffold) markers | `// scaffold:<list>` lines in `contracts.ts`, `domain.ts`, `policy.ts`, `server.ts`, `application.ts`, `screens.tsx` | The scaffold's own tests on a generated application: [`packages/scaffold/src/generate.test.ts`](../../packages/scaffold/src/generate.test.ts) |
| [Collection](../../docs/primitives.md#collection) with generated get and list | `contracts/delivery.ts` (`deliveries`, `deliveryOperations`); `handlers/delivery.ts` | [`test/receiving.test.ts`](test/receiving.test.ts), [`test/conformance.test.ts`](test/conformance.test.ts) |
| [Policy](../../docs/primitives.md#policy) built with `definePolicy` | `policy.ts` (`appPolicy`): caller gate, editor and person-only rules, the ERP lane | `test/receiving.test.ts`: viewer refusals on accept and resolve; every notice import passes the lane |
| [Target](../../docs/primitives.md#target) for the ERP | `contracts/erp-target.ts` (`erpTarget`); `handlers/erp-target.ts` (`erpHandlers`); `application.ts` (`connectTarget`) | `test/receiving.test.ts`: the first test |
| [Outbox effect](../../docs/primitives.md#outbox-effect) acknowledged as upstream | `handlers/erp-target.ts` (`erp.send`, effect type `goods-receipt.post`) | `test/receiving.test.ts`: `upstream: 2` after the first delivery pass |
| [Connector](../../docs/primitives.md#connector) over exchange folders | `erp-port.ts` (`erpPort`, built on `fileTargetPort`) | `test/receiving.test.ts` with `FakeFileConsumer` as the ERP |
| [Requirement declaration](../../docs/primitives.md#requirement-declaration) of folders | `contracts/erp-target.ts` (`erpExchange`); `manifest.ts` (`components`) | Every test that opens the application; [`test/ui-bindings.test.ts`](test/ui-bindings.test.ts) builds the catalog with `manifest.components` |
| [Site policy](../../docs/primitives.md#site-policy) folder bindings | `sitePluginManifest` in `manifest.ts`; `sitePlugin` in `application.ts` | `test/receiving.test.ts`: the unbound drop folder test; [`e2e/receiving.pw.ts`](e2e/receiving.pw.ts) |
| [Inbound sync](../../docs/primitives.md#inbound-sync) of notices | `erp-port.ts` (`feed`); `handlers/erp-target.ts` (`applyBatch`) | `test/receiving.test.ts`: the corrected notice and malformed export test |
| [Reconciliation](../../docs/primitives.md#reconciliation) of held goods receipts | `contracts.ts` (`reconciliationOperations`); `handlers/reconciliation.ts`; `ui/reconcile.tsx` | `test/receiving.test.ts`: the unreadable receipt file test; the second test in `e2e/receiving.pw.ts` |
| [Agent definition](../../docs/primitives.md#agent-definition) with `output: 'propose'` | `contracts.ts` (`receiving.discrepancy`) | [`test/agent-scenarios.test.ts`](test/agent-scenarios.test.ts) |
| [Proposal](../../docs/primitives.md#proposal) accepted under the accepter | `handlers/proposals.ts`; `ui/delivery.tsx`; `ui/proposals.tsx` | `test/receiving.test.ts`: the agent grant and viewer acceptance checks |
| [Agent scenario](../../docs/primitives.md#agent-scenario) on the deterministic harness | `test/agent-scenarios.test.ts` (`runAgentScenarios`) | The same file |
| [Surface adapter](../../docs/primitives.md#surface-adapter) parity | Generated from the catalog; no example code | `test/conformance.test.ts`: instance, HTTP, CLI and MCP read one list |
| [UI registry](../../docs/primitives.md#ui-registry) screens and [capability bindings](../../docs/primitives.md#capability-binding) | `ui/delivery.tsx`; `ui/proposals.tsx`; `ui/reconcile.tsx` | `test/ui-bindings.test.ts`, `e2e/receiving.pw.ts` |
| [Live query](../../docs/primitives.md#journal-and-live-query) of target status | `ui/erp-target.tsx` (`live.liveQueryOptions`) | `e2e/receiving.pw.ts`: the ERP screen shows the goods receipt accepted |

## Structure

| Path | Holds |
| --- | --- |
| `manifest.ts` | The browser-safe manifest: the module, the `erpExchange` folder declarations and the site, network, audit and compliance [host plugins](../../docs/primitives.md#host-plugin). |
| `contracts.ts` | The `operations` map, the module and the inline `receiving.discrepancy` agent definition. |
| `contracts/delivery.ts` | The delivery line schema, the `deliveries` collection, its generated reads and the receive and classify commands. |
| `contracts/erp-target.ts` | The ERP target, the notice line schema, the folder IDs, the `erpExchange` declaration and the `erp.send` command. |
| `domain.ts` | Roles, the state shape, `createState`, `upgradeState` and the `discrepant` check. |
| `policy.ts` | The policy: caller gate, editor rule, person-only rules, the ERP lane and event visibility. |
| `server.ts` | `createHandlers`, which lists every handler group, and the policy export. |
| `handlers/` | One file per group: delivery lines, the ERP target, proposals and reconciliation; `context.ts` binds handlers to the state and services. |
| `erp-port.ts` | The ERP connector: CSV encoding of goods receipts and CSV mapping of notice rows. |
| `application.ts` | `createReceivingApplication`, which composes plugins and connects the ERP target to the folder port. |
| `screens.tsx`, `ui/` | The screen definitions, the line screen, the proposals, Held receipts and ERP status screens. |
| `test/`, `e2e/` | Behavioral, agent scenario, cross-surface and UI binding tests, and the Playwright spec. |

## Notice import flow

1. The ERP writes a CSV export into the folder that the site policy binds to `erp-asn`.
2. The target's inbound sync asks the connector in `erp-port.ts` for changes. The folder feed reads only files that have been quiet for the quiet period, which is 2 seconds unless the application's `quietMs` option sets it.
3. The feed parses each row and passes it to the example's mapping callback, which converts the expected quantity to a number. The callback validates the row against `asnLineSchema`, and a row that does not fit fails the whole pass.
4. The integration principal submits the batch as `erp.sync`. The policy admits that principal only through the ERP target's lane in `policy.ts`.
5. The target's generated sync handler refuses a batch that does not start at the stored watermark. It then applies the batch with the example's batch callback in `handlers/erp-target.ts`.
6. The batch callback inserts each new line with status `expected`. It updates a known line only while nobody has counted it, so a count is never overwritten.
7. The handler stores the new watermark and the sync time. The `erp.sync.status` query reports them on the ERP screen.

## Goods receipt flow

1. An editor records a count with `delivery.receive`. A count equal to the expected quantity clears the reason and note, and a posted line conflicts.
2. A line whose count differs from the notice needs a reason. An editor sets it with `delivery.classify`, or accepts a proposal for it.
3. The agent runs under a grant built by `agentGrant`, which holds its queries and proposal submission but not the classify command. Accepting a proposal runs the classify command under the accepter, so the editor rule refuses a viewer.
4. An editor posts the line with `erp.send`. The handler in `handlers/erp-target.ts` refuses an uncounted line, a discrepancy without a reason, and a line whose posting is pending or accepted.
5. The handler enqueues an effect of type `goods-receipt.post` on the line's resource, in the same transaction as the line. It sets the line to posted and stores the effect ID with a pending delivery state.
6. After the commit, the [dispatcher](../../docs/primitives.md#dispatcher) calls the connector's deliver method. The encode callback in `erp-port.ts` turns the payload into one CSV row, written as a file named after the effect ID in the drop folder.
7. The connector reports the delivery as pending, so the effect becomes upstream. The dispatcher then polls the connector's lookup, which reads the receipt file named after the effect ID from `erp-receipts`.
8. A receipt file that accepts or rejects the goods receipt settles the effect through `erp.effect.settle`, and the example's outcome hook records the outcome on the line. A rejection sets the line back to counted, so it can be recounted and posted again.
9. A receipt file that cannot be parsed makes the dispatcher hold the effect. The Held receipts screen lists it through `reconciliation.list`, and an editor decides it there.
10. The resolve hook in `handlers/reconciliation.ts` records an applied or refused decision on the line's posting. A not-applied decision releases the effect for another delivery, and the posting stays pending.

## Implementation steps

The steps build an application equivalent to the example. The example itself was generated with the scaffold's new, add target and add capability commands. Its agent and reconciliation were written by hand. The steps use `add agent` for the agent, which generates the same proposal parts.

Run `scaffold new` from the framework checkout's root, and every later command from the new checkout's root unless a step names another directory. Steps 7 to 39 edit files, and the application typechecks again once they are all done.

1. Export the framework with a new application whose first collection is `delivery`, into a directory that is absent and outside the checkout. The [create-agent-native-app skill](../../packages/scaffold/skills/create-agent-native-app/SKILL.md) covers this step.

   ```sh
   bun run scaffold new /absolute/path/to/goods-receiving --name receiving --display-name "Goods receiving" --collection delivery
   ```

2. Install the pinned dependencies in the new checkout, which also links the skills.

   ```sh
   cd /absolute/path/to/goods-receiving
   bun install --frozen-lockfile
   ```

3. Add the ERP target over the collection. The command writes the target's files with a fake port, and lists an `erp-api` destination as disabled in the desktop site policy.

   ```sh
   bun run scaffold add target erp --collection delivery
   ```

4. Add the two commands, each with an empty contract and a headless UI exception, a handler, an editor rule and a test. The [add-capability skill](../../packages/runtime/skills/add-capability/SKILL.md) covers the shaping.

   ```sh
   bun run scaffold add capability delivery.receive --kind command --description "Record the quantity counted for a delivery line. Editors only."
   bun run scaffold add capability delivery.classify --kind command --description "Give the reason a counted quantity differs from the expected one. Editors only."
   ```

5. Add the proposing agent, which the scaffold writes to `contracts/discrepancy-agent.ts` together with the proposal capabilities and a Proposals screen. Its agent ID is `receiving.discrepancy`.

   ```sh
   bun run scaffold add agent discrepancy --collection delivery
   ```

6. Format the generated files and generate the reference, as the scaffold's output asks after each part.

   ```sh
   bun run format
   bun run generate
   ```

7. In `contracts/discrepancy-agent.ts`, give the agent the delivery queries, the classify command, the proposal list and instructions to propose discrepancy reasons.
8. Move both generated commands into the collection's operations object and handler list, as the example does, and delete their generated contract and handler files. Remove their contract imports and operations-map entries from `contracts.ts`, and their handler imports and handler groups from the server entrypoint.
9. In `contracts/delivery.ts`, replace the generated item schema with the notice fields, the count, the reason, the note, the status and the arrival time. Set the status values to expected, counted and posted, and add a posting field that holds the effect ID and the fields of `deliveryShape`.
10. Remove the generated create and update commands from `contracts/delivery.ts`, together with their two policy rules and their two handlers. The agent stopped naming the update command in step 7, so the catalog still builds.
11. Change the list handler's order and search text in `handlers/delivery.ts` to the new fields, and rewrite the list query's description to match.
12. Define the notice line schema in `contracts/erp-target.ts` as a pick of the notice fields, and make it the target's feed item. Use its type in place of the generated `ErpItem` in the application, and in place of the local item type in the target handlers.
13. Rewrite the target's settle, sync and status descriptions for notices and goods receipts.
14. Widen the two commands in `contracts/delivery.ts` with strict input schemas and the delivery output schema. Change each permission's resource type to `Delivery`, add the delivery dependency and replace the headless exception with a UI binding.
15. Add a discrepancy check to `domain.ts` that tells whether a counted line differs from its notice. The delivery handlers and the target handlers both use it.
16. Implement the two command handlers in `handlers/delivery.ts` with the collection's record helpers, the discrepancy check and a conflict error for refused states.
17. Declare the exchange folders with `fileExchange` next to the target's declaration, and add a components list to the manifest that holds the declaration. The example uses these folder IDs, as the [connector-files README](../../plugins/connector-files/README.md) describes:
    - inbox `erp-asn`, for notice exports;
    - drop `erp-goods-receipts`, for goods receipt files;
    - receipts `erp-receipts`, for the ERP's receipt files.
18. Remove the generated `erp-api` entry from the module's network list and from the desktop site policy. A binding for a destination that nothing declares is a site policy error, even when the binding is disabled.
19. Rename the generated effect type to `goods-receipt.post`, and export it as a constant from the target handlers file for the port to check.
20. Replace the generated fake in `erp-port.ts` with a port factory that returns the connector's file target port. Give it a CSV drop whose encode callback writes a goods receipt as one row and rejects any other effect type.
21. Give the port factory a CSV feed and a quiet period option that it passes to the feed. The feed's mapping callback converts the expected quantity to a number, validates the row against the notice line schema and throws on a row that does not fit.
22. In the application definition, build the target's port from the connect context's folder port unless the generated `erp` option supplies one. Add a quiet period option to the application and pass it to the port factory.
23. Remove the generated `erpDeliveries` map from the state type and the initial state, together with its type import. Store the posting on the delivery line instead.
24. Rewrite the send handler in `handlers/erp-target.ts` with the posting preconditions and a goods receipt payload that holds the columns the port writes. Rewrite the send command's description to list its three refusals.
25. Rewrite the target's outcome hook, batch callback and status counts in the same file, as the example does.
26. Write `handlers/reconciliation.ts`, which calls the runtime's reconciliation handlers with a visibility filter for delivery effects and a resolve hook. The [connect-system-of-record skill](../../packages/integration/skills/connect-system-of-record/SKILL.md) covers this step and the target steps.
27. List the reconciliation handler group in `server.ts`, and spread the framework's reconciliation capabilities into the operations map.
28. Give the reconciliation list query the open rule, and the resolve command the editor rule with `person: true`.
29. In `ui/delivery.tsx`, drop the create form from the list screen and replace the generated record screen with a line screen. The [build-screens skill](../../packages/frame/skills/build-screens/SKILL.md) covers the screen steps.
30. Put the count, reason and send forms and the proposal review on the line screen, and remove the send form from the ERP screen.
31. Add a Held receipts screen with the reconciliation review, and register its route, navigation item and capability screen prefix in `screens.tsx`.
32. Rewrite the generated conformance test on the model of `test/conformance.test.ts`. That test opens the application with a quiet period of 0, binds the notice folder, writes a notice, syncs and counts.
33. Pass the manifest's components to the UI binding test, as `test/ui-bindings.test.ts` does. Without them the catalog refuses the ERP target, which then has no declared network destination, folder or process.
34. In the generated target test, keep the case that refuses a viewer's send and a person's sync, and drop the other case. Change the file's open helper so it builds the application without the fake and without the `erp` option.
35. Replace the generated collection, capability and agent tests with a behavioral test like `test/receiving.test.ts` and agent scenarios like the example's. The generated tests use the create command or empty inputs.
36. Open the application in those tests with `openEmbeddedInstance`, a quiet period of 0 and a site policy setting that binds the three folders to temporary directories.
37. Play the ERP with `FakeFileConsumer` from the connector's testing entrypoint. Run each delivery pass with `runOnce` on the ERP target's dispatcher from the instance's integrations, with backoff ignored.
38. Replace the generated default screens spec with a spec like `e2e/receiving.pw.ts`. Keep the package name that the generated spec passes to `startService`, because the example's spec names the example's own package.
39. Rewrite the generated `README.md` with the entrypoints, exchange folders, trust boundary and tests, as the example's README does.
40. Run the focused checks, then the full check. The [check-a-change skill](../../packages/testing/skills/check-a-change/SKILL.md) says which to report.

    ```sh
    bun run format
    bun run generate
    bun run typecheck
    bun test examples/receiving
    bunx playwright test examples/receiving
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

42. Start the application with that policy from the new checkout's root. The application also starts from its own directory, `examples/receiving`, with the same variable.

    ```sh
    AGENT_NATIVE_SITE_POLICY=/absolute/path/to/site-policy.json bun run dev
    ```

Without the folder bindings the host starts, imports no notices and keeps posted goods receipts in the outbox. The [deploy-to-site skill](../../plugins/site/skills/deploy-to-site/SKILL.md) covers site policies. The ERP side replaces `FakeFileConsumer` and follows the rules in the [connector-files delivery section](../../plugins/connector-files/README.md#delivery).

## Limits

- **No real ERP.** The exchange has run against temporary directories and `FakeFileConsumer` only, with no network share or mount ([implementation status](../../docs/implementation-status.md)).
- **Model runs.** The agent scenarios have run with the deterministic harness only ([implementation status](../../docs/implementation-status.md)).
- **Polling.** Folders are polled, and a file is read only after its quiet period, 2 seconds by default. An export is therefore imported 2 seconds after its last change at the earliest.
- **Share clock.** The feed's watermark uses the share's file times, so a file server whose clock runs behind the host can sort a new file before the watermark.
- **Malformed exports.** A row that fails the line schema fails the whole pass, so notice import stops until the ERP replaces or removes that file.
- **Counted lines.** A corrected notice does not change a line that someone has counted, so the receiver does not see a later change to `expected` on that line.
- **Repeat postings.** A posted line refuses further counts and reasons until its goods receipt is rejected, by the ERP or by a reconciliation decision.
- **Visibility.** Every member sees every line, proposal and held goods receipt, and roles apply to the whole workspace with no container scoping.
- **Integration lane.** No example test checks that a person is refused the ERP's sync and settle capabilities.
- **No agents marker.** The example's `contracts.ts` has no agents marker, so the scaffold cannot add an agent to it.

## Related pages

- [System-of-record pattern](../../docs/systems-of-record.md)
- [connector-files README](../../plugins/connector-files/README.md)
- [Scaffold README](../../packages/scaffold/README.md)
- [create-agent-native-app skill](../../packages/scaffold/skills/create-agent-native-app/SKILL.md)
- [connect-system-of-record skill](../../packages/integration/skills/connect-system-of-record/SKILL.md)
- [Quality inspection](../quality-inspection/README.md)
- [CRM capture](../crm-capture/README.md)
- [Line station](../line-station/README.md)

## Skills

The example has no skills of its own. [create-agent-native-app](../../packages/scaffold/skills/create-agent-native-app/SKILL.md) generated it, and [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md) covers the ERP target.
