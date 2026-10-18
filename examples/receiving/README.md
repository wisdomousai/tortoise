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

- `test/receiving.test.ts` runs an embedded authority with a site policy that binds the folders to temporary directories, and `FakeFileConsumer` playing the ERP. It covers:
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

## Skills

The example has no skills of its own. [create-agent-native-app](../../packages/scaffold/skills/create-agent-native-app/SKILL.md) generated it, and [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md) covers the ERP target.
