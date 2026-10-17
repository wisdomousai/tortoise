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
- [Membership](../../docs/primitives.md#membership): `defineMembership`, `Membership`, `MembershipSpec`, `SetMemberInput`, `SetMemberOutput`.
- [Collection](../../docs/primitives.md#collection): `defineCollection`, `Collection`, `collectionGet`, `collectionList`, `listFilters`, `listSearches`, `recordKeySchema`, `MAX_PAGE`, and the `CollectionPage` output shape.
- [Event log](../../docs/primitives.md#event-log): the audit envelope and port (`EventLogPort`, `AuditEvent`, `auditEventKinds`, `failClosedAuditMode`).

The worked example is [`examples/project-tasks/contracts.ts`](../../examples/project-tasks/contracts.ts). [Capability authoring](../../docs/capability-authoring.md) walks through adding an operation.

## Entrypoints

| Import                      | Runs in            | Contents                                                                                                                                      |
| --------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/contracts`   | browser and server | Everything below, plus JSON helpers (`assertJson`, `canonicalJson`) and the capability type helpers.                                          |
| `@agent-native/contracts/*` | browser and server | One source file: `json`, `schema`, `capability`, `catalog`, `errors`, `requirements`, `audit`, `data-provider`, `collection` or `membership`. |

## Trust boundary

Contracts are trusted code but describe untrusted input. `jsonSchema` validation rejects input it would have to strip or transform, and wire values must be JSON. `buildCatalog` fails before startup on duplicate IDs, missing or cyclic dependencies, missing UI declarations, unresolved workflow references, colliding MCP names and requirement errors (an outbox target without a queuing destination, a process naming an undeclared destination, a remote query whose target no destination `reads`). A declaration grants nothing by itself: a site policy binds it and the egress guard enforces it.

Audit events carry references and digests. Input values appear only for the fields a capability lists in `audit.fields`.

## Dependencies

External: `zod`. No framework packages. This package must stay importable by a browser and by the generators: `bun run check:boundaries` rejects host runtimes, provider SDKs and server-only framework packages here.

## Tests

```sh
bun test packages/contracts
```

`test/data-provider.test.ts` covers data providers: literal IDs and types survive, both queries declare `remote`, search pages with a cursor the provider cannot redefine, and a provider without a destination that reads its target fails composition.

`test/contracts.test.ts` rejects an operation without a UI binding or declared exception, duplicates, cycles, unresolved workflows, colliding MCP names and invalid requirements.
