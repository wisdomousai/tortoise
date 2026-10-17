# @agent-native/contracts

Capabilities, modules and the composed catalog, as plain browser-safe data. Everything else in the framework reads these values: the runtime executes them, the surface adapters expose them, the generators describe them and the frontend binds them. Contracts carry schemas, permissions, UI bindings and declared requirements. They never carry handlers.

Layer: framework (`packages/*`). Domain-neutral; a domain defines its capabilities with this package in its own `contracts.ts`.

## Primitives

- [Capability](../../docs/primitives.md#capability): `defineCapability`, `jsonSchema`, `PermissionRequirement`, `IntegrationDeclaration`, `RemoteReadDeclaration`.
- [Module](../../docs/primitives.md#module): `defineModule`, `CapabilityModule`.
- [Catalog](../../docs/primitives.md#catalog): `buildCatalog`, `Catalog`, `CatalogOperation`.
- [Command](../../docs/primitives.md#command): the caller-safe error envelope (`ApplicationError`, `ErrorCode`, `errorEnvelope`).
- [Requirement declaration](../../docs/primitives.md#requirement-declaration): `Requirements`, `NetworkDestination`, `DeviceRequirement`, `ProcessRequirement`, `defineHostComponent`, `collectRequirements`, `destinationsForTarget`, `destinationsForRead`.
- [Remote query](../../docs/primitives.md#remote-query): the result shape every remote query returns (`remoteResultSchema`, `RemoteResult`, `remoteSourceStatusSchema`, `RemoteSourceStatus`) and its opaque page cursor (`remoteCursorSchema`).
- [Data provider](../../docs/primitives.md#data-provider): `defineDataProvider`, `DataProvider`, `DataProviderSpec`.
- [Blob store](../../docs/primitives.md#blob-store): `BlobRef`, `blobRefSchema`, `isBlobRef`, `BlobLimits` (a command's `blobs`), `blobFits`, `assertBlobLimits`, `maxBlobBytes`, `blobDigestPattern`, `mediaTypePattern`.
- [Event log](../../docs/primitives.md#event-log): the audit envelope and port (`EventLogPort`, `AuditEvent`, `auditEventKinds`, `failClosedAuditMode`).
- [OS handler](../../docs/primitives.md#os-handler): `OsHandler`, `OsTarget`, `OsDeclarations` (a module's or component's `os`), `CatalogOs`, `osRequestFields` and the path and template syntax (`linkPathSegments`, `linkPathShape`, `templatePlaceholders`, `isWholePlaceholder`).
- [OS action](../../docs/primitives.md#os-action): `OsAction`, `CatalogOsAction` and `osActionTargets`, the outbox targets notify actions carry.
- [Shell port](../../docs/primitives.md#shell-port): the values that cross between adapters, the host's shell routes, the port and the frame (`OsPlatform`, `osPlatforms`, `RawOsRequest`, `OsDelivery`, `OsProvenance`, `OsRefusal`, `OsRequestOutcome`, `OsActionRequest`, `OsInstruction`, `OsActionOutcome`, `OsActionResult`).

The worked example is [`examples/project-tasks/contracts.ts`](../../examples/project-tasks/contracts.ts). [Capability authoring](../../docs/capability-authoring.md) walks through adding an operation.

## Entrypoints

| Import                      | Runs in            | Contents                                                                                                                                                                 |
| --------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@agent-native/contracts`   | browser and server | Everything below, plus JSON helpers (`assertJson`, `canonicalJson`) and the capability type helpers.                                                                     |
| `@agent-native/contracts/*` | browser and server | One source file: `json`, `schema`, `capability`, `catalog`, `errors`, `requirements`, `audit`, `data-provider`, `blob`, `os`, `os-catalog`, `os-templates` or `os-wire`. |

## Trust boundary

Contracts are trusted code but describe untrusted input. `jsonSchema` validation rejects input it would have to strip or transform, and wire values must be JSON. `buildCatalog` fails before startup on duplicate IDs, missing or cyclic dependencies, missing UI declarations, unresolved workflow references, colliding MCP names, blob limits on a query or outside 1 byte to 256 MiB, OS declarations that break the rules in `os-catalog.ts`, and requirement errors (an outbox target without a queuing destination or queuing notify action, a process naming an undeclared destination, a remote query whose target no destination `reads`). A declaration grants nothing by itself: a site policy binds it and the egress guard enforces it.

An OS handler describes requests from any application or web page on the device, so its params and templates are validated again when a request arrives; the catalog only proves the declaration is coherent.

Audit events carry references and digests. Input values appear only for the fields a capability lists in `audit.fields`.

## Dependencies

External: `zod`. No framework packages. This package must stay importable by a browser and by the generators: `bun run check:boundaries` rejects host runtimes, provider SDKs and server-only framework packages here.

## Tests

```sh
bun test packages/contracts
```

`test/data-provider.test.ts` covers data providers: literal IDs and types survive, both queries declare `remote`, search pages with a cursor the provider cannot redefine, and a provider without a destination that reads its target fails composition.

`test/os.test.ts` covers OS declarations: catalog output, refused paths, templates, prefill targets and payload limits, duplicate claims, refused open URLs, and notify actions with reply handlers and outbox targets.

`test/contracts.test.ts` rejects an operation without a UI binding or declared exception, duplicates, cycles, unresolved workflows, colliding MCP names and invalid requirements.
