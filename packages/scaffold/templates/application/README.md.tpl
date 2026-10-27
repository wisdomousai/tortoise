# {{packageName}}

{{displayName}}. Created by `scaffold new`; extend it with `bun run scaffold add collection|capability|target <name>` and replace the default screens one route at a time.

Layer: content (`showcase/examples/*`).

## Primitives

This is one [Application](../../../docs/primitives.md#application). Its [Module](../../../docs/primitives.md#module) holds [collections](../../../docs/primitives.md#collection) with generated reads, commands written over `records`, and a [Policy](../../../docs/primitives.md#policy) built with `definePolicy`. Systems of record are declared as [targets](../../../docs/primitives.md#target). The `site`, `network`, `audit` and `compliance` [host plugins](../../../docs/primitives.md#host-plugin) are listed in each entrypoint.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `{{packageName}}/manifest` | browser and server | Default export: `defineManifest` with id `{{app.kebab}}` and its module. |
| `{{packageName}}/application` | server only | Default export: the application. `create{{app.pascal}}Application` takes services, members and target ports. |
| `{{packageName}}/screens` | browser | Default export: `defineScreens` with the default screens of each collection. |
| `{{packageName}}/*` | see file | Other modules by name: `contracts` (browser-safe), `domain`, `policy`, `server`. |

Lines marked `// scaffold:<list>` are where `scaffold add` inserts operations, handlers, rules and routes. Keep them, or extend those lists by hand.

## Trust boundary

Only workspace members pass the policy's caller gate. Editors run commands; viewers read. Integration principals hold no role and act only in their target's lane. Every list scopes rows before filters, counts and paging.

## Dependencies

Framework packages and the four host plugins, through the root workspace.

## Tests

```sh
bun test showcase/examples/{{app.kebab}}
```

`test/conformance.test.ts` reads one list through the instance, HTTP, the CLI and MCP; `test/ui-bindings.test.ts` checks that every bound operation is referenced by a screen; `e2e/default-screens.pw.ts` creates, opens and edits a {{one.words}} through the default screens in a browser (`bunx playwright test showcase/examples/{{app.kebab}}`); each generated part has its own behavioral test.
