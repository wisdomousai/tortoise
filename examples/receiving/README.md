# @agent-native/receiving

Goods receiving against an ERP that is reached only through shared folders. The ERP exports advance shipping notices as CSV into an inbox folder; each line becomes a delivery line. A receiver counts it, gives a reason when the count differs (or accepts the reason an agent proposes), and posts the goods receipt. The receipt is written as one CSV file into the ERP's drop folder, and the ERP answers with a receipt file that settles it.

Layer: content (`examples/*`). It was created with `scaffold new` and extended with `scaffold add target` and `scaffold add capability`, then written by hand on those parts. It has 783 lines of application source outside its tests, against 1,837 for `crm-capture`.

## Primitives

This is one [Application](../../docs/primitives.md#application). It uses:

- a [Collection](../../docs/primitives.md#collection) of delivery lines with generated reads and the default list and record screens;
- a [Policy](../../docs/primitives.md#policy) built with `definePolicy`;
- the ERP as a [Target](../../docs/primitives.md#target) whose [Connector](../../docs/primitives.md#connector) is `fileTargetPort` from [`connector-files`](../../plugins/connector-files/README.md), over three exchange folders declared as [requirements](../../docs/primitives.md#requirement-declaration) and bound by the [Site policy](../../docs/primitives.md#site-policy);
- an [Agent definition](../../docs/primitives.md#agent-definition), `receiving.discrepancy`, whose [proposals](../../docs/primitives.md#proposal) a person accepts or rejects.

The `site`, `network`, `audit` and `compliance` [host plugins](../../docs/primitives.md#host-plugin) are listed in each entrypoint.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/receiving/manifest` | browser and server | Default export: `defineManifest` with id `receiving`, its module and the ERP exchange folders. |
| `@agent-native/receiving/application` | server only | Default export: the application. `createReceivingApplication` takes services, members, an ERP port and the notice quiet period. |
| `@agent-native/receiving/screens` | browser | Default export: `defineScreens` with the delivery list, the line screen, proposals and the ERP status. |
| `@agent-native/receiving/*` | see file | Other modules by name: `contracts` (browser-safe), `domain`, `policy`, `server`, `erp-port`. |

Lines marked `// scaffold:<list>` are where `scaffold add` inserts operations, handlers, rules and routes.

## Exchange folders

| Folder ID | Access | Contents |
| --- | --- | --- |
| `erp-asn` | read | Advance shipping notice exports: CSV with `id`, `purchaseOrder`, `supplier`, `sku`, `description`, `expected` |
| `erp-goods-receipts` | write | One goods receipt per posted line: CSV with `delivery`, `purchaseOrder`, `sku`, `counted`, `reason`, `note`, named `<effect id>.csv` |
| `erp-receipts` | read | The ERP's answer per file, `<effect id>.json`, as the [connector-files README](../../plugins/connector-files/README.md#delivery) describes |

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

Until they are bound, no notice is imported and posted receipts wait in the outbox. They are delivered once a restarted host finds the folders bound.

## Trust boundary

Only workspace members pass the policy's caller gate. Editors count, classify and post; viewers read. The integration principal `erp-integration` holds no role and acts only in the ERP target's lane. Any member may propose; the agent proposes under the grant of the member who started it, which leaves out `delivery.classify` itself. Accepting runs the proposed command under the accepter, so only an editor's acceptance commits, and deciding needs a person.

Notice rows are input: a row that does not fit the line schema fails the import, so a malformed export is reported, not half applied. A notice line that someone has counted is never overwritten by a later export.

## Dependencies

Framework packages, the four host plugins and `@agent-native/connector-files`, through the root workspace.

## Tests

```sh
bun test examples/receiving
bunx playwright test examples/receiving
```

- `test/receiving.test.ts` runs an embedded authority with a site policy that binds the folders to temporary directories, and `FakeFileConsumer` playing the ERP. It covers:
  - notice import;
  - the agent's grant refusing a direct classification and a viewer's acceptance being refused;
  - posting with a pending upstream and settling from the receipt;
  - an unbound drop folder holding the receipt until a restarted host binds it;
  - a rejected receipt reopening the line;
  - corrected notices and a malformed export.
- `test/conformance.test.ts` imports a notice through a served host, counts over HTTP, and reads one list through the authority, HTTP, the CLI and MCP.
- `test/ui-bindings.test.ts` checks that every bound operation is referenced by a screen.
- `e2e/receiving.pw.ts` starts the real service with a site policy, waits for the notice import, then counts, classifies and posts a line in the browser. The test answers as the ERP, and the ERP screen then shows the receipt accepted.

## Skills

None of its own. [create-agent-native-app](../../packages/scaffold/skills/create-agent-native-app/SKILL.md) generated it, and [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md) covers the ERP target.
