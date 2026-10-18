# @agent-native/contracts

This package holds [capabilities](../../docs/glossary.md#capability), [modules](../../docs/glossary.md#module) and the composed [catalog](../../docs/glossary.md#catalog) as plain browser-safe data. The runtime executes these values, the [surface](../../docs/glossary.md#surface) adapters expose them, the [generators](../../docs/glossary.md#generator) describe them and the [screens](../../docs/glossary.md#screen) bind them. Contracts carry schemas, permissions, UI bindings and declared requirements, and never handlers.

## Layer

Framework (`packages/*`). Domain-neutral. A domain defines its capabilities with this package in its own `contracts.ts`. Contracts are trusted code that describe untrusted input.

## Primitives

- [Capability](../../docs/primitives.md#capability): `defineCapability`, `jsonSchema`, `PermissionRequirement`, `IntegrationDeclaration`, `RemoteReadDeclaration`, and `jsonValueSchema`. `jsonValueSchema` accepts any JSON value and is the one recursive schema the portability check accepts.
- [Module](../../docs/primitives.md#module): `defineModule`, `CapabilityModule`.
- [Catalog](../../docs/primitives.md#catalog): `buildCatalog`, `Catalog`, `CatalogOperation`.
- [Agent definition](../../docs/primitives.md#agent-definition): `defineAgent`, `AgentDefinition`, `AgentBudgets`, `AgentOutput`, `ModelRequirement`, `CatalogAgent`, and the catalog checks `checkAgent` and `catalogAgents`. `agentInstructions` is the text a run's model starts with, and for a requesting agent it lists each command the agent may request approval for with its input schema.
- Tool schemas: harnesses and surfaces build a capability's tool schema with `operationToolSchema`, or with `toolEnvelopeSchema` and `expectedRevisionsSchema`. These move a recursive input's `$defs` to the envelope's root, so llama.cpp and strict MCP clients resolve them.
- [Command](../../docs/primitives.md#command): the caller-safe error envelope, `ApplicationError`, `ErrorCode` and `errorEnvelope`.
- [Requirement declaration](../../docs/primitives.md#requirement-declaration): `Requirements`, `NetworkDestination`, `DeviceRequirement`, `ProcessRequirement`, `defineHostComponent`, `collectRequirements`, `destinationsForTarget`, `destinationsForRead`.
- [Remote query](../../docs/primitives.md#remote-query): the result shape every remote query returns, with `remoteResultSchema`, `RemoteResult`, `remoteSourceStatusSchema` and `RemoteSourceStatus`. Its opaque page cursor is `remoteCursorSchema`.
- [Data provider](../../docs/primitives.md#data-provider): `defineDataProvider`, `DataProvider`, `DataProviderSpec`.
- [Membership](../../docs/primitives.md#membership): `defineMembership`, `Membership`, `MembershipSpec`, `SetMemberInput`, `SetMemberOutput`.
- [Target](../../docs/primitives.md#target): `defineTarget`, `Target`, `TargetSpec`, `SyncBatch`, `effectOutcomeSchema`, `EffectOutcomeInput`, `deliveryStatusSchema`, `rejectionSchema`, `deliveryShape`.
- [Approval request](../../docs/primitives.md#approval-request): `approvalOperations` under fixed `approval.*` IDs, `approvalRequestSchema` with `Approval request`, `approvalStatusSchema` with `ApprovalStatus`, and the `approval requests` collection.
- [Reconciliation](../../docs/primitives.md#reconciliation): `reconciliationOperations` for `reconciliation.list` and `reconciliation.resolve`, `heldEffectSchema` with `HeldEffect`, and `reconciliationDecisionSchema` with `ReconciliationDecision`.
- [Collection](../../docs/primitives.md#collection): `defineCollection`, `Collection`, `collectionGet`, `collectionList`, `listFilters`, `listSearches`, `recordKeySchema`, `MAX_PAGE`, and the `CollectionPage` output shape.
- [Blob store](../../docs/primitives.md#blob-store): `BlobRef`, `blobRefSchema`, `isBlobRef`, `blobFits`, `assertBlobLimits`, `maxBlobBytes`, `blobDigestPattern`, `mediaTypePattern`, and `BlobLimits`, a command's `blobs`.
- [Audit log](../../docs/primitives.md#audit-log): the audit envelope and port, `EventLogPort`, `AuditEvent`, `auditEventKinds` and `failClosedAuditMode`.
- [OS handler](../../docs/primitives.md#os-handler): `OsHandler`, `OsTarget`, `CatalogOs`, `osRequestFields`, and `OsDeclarations`, a module's or component's `os`. The path and template syntax is `linkPathSegments`, `linkPathShape`, `templatePlaceholders` and `isWholePlaceholder`.
- [OS action](../../docs/primitives.md#os-action): `OsAction`, `CatalogOsAction`, and `osActionTargets`, the outbox targets that notify actions carry.
- [Shell port](../../docs/primitives.md#shell-port): the values that cross between adapters, the host's shell routes, the port and the frame. They are `OsPlatform`, `osPlatforms`, `RawOsRequest`, `OsDelivery`, `OsProvenance`, `OsRefusal`, `OsRequestOutcome`, `OsActionRequest`, `OsInstruction`, `OsActionOutcome` and `OsActionResult`.

The worked example is [`examples/project-tasks/contracts.ts`](../../examples/project-tasks/contracts.ts). [Capability authoring](../../docs/capability-authoring.md) walks through adding a capability.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/contracts` | browser and server | Everything below, plus JSON helpers (`assertJson`, `canonicalJson`) and the capability type helpers. |
| `@agent-native/contracts/*` | browser and server | One source file, listed below. |

The source files are `json`, `schema`, `capability`, `catalog`, `errors`, `requirements`, `audit`, `data-provider`, `collection`, `membership`, `target`, `agent`, `agent-instructions`, `approval`, `reconciliation`, `blob`, `os`, `os-catalog`, `os-templates` and `os-wire`.

## Trust boundary

`jsonSchema` validation rejects input it would have to strip or transform. Wire values must be JSON.

`buildCatalog` fails before startup on:

- duplicate IDs, and missing or cyclic dependencies;
- missing UI declarations and unresolved workflow references;
- colliding MCP names;
- blob limits on a query, or outside 1 byte to 256 MiB;
- OS declarations that break the rules in `os-catalog.ts`;
- requirement errors.

The requirement errors are an outbox target without a queuing destination or queuing notify action, a process naming an undeclared destination, and a remote query whose target no destination `reads`. A declaration grants nothing by itself. A [site policy](../../docs/glossary.md#site-policy) binds it, and the [egress guard](../../docs/glossary.md#egress-guard) enforces it.

An OS handler describes requests from any application or web page on the device. Its params and templates are therefore validated again when a request arrives. The catalog only proves that the declaration is coherent.

Audit events carry references and digests. Input values appear only for the fields a capability lists in `audit.fields`.

## Dependencies

External: `zod`. No framework packages. This package must stay importable by a browser and by the generators. `bun run check:boundaries` rejects host runtimes, provider SDKs and server-only framework packages here.

## Tests

```sh
bun test packages/contracts
```

- `test/data-provider.test.ts`: literal IDs and types survive, and both queries declare `remote`. Search pages with a cursor the provider cannot redefine, and a provider without a destination that reads its target fails composition.
- `test/agent.test.ts`: agent definitions are sorted with their module in the catalog, and a requesting agent's instructions are checked. Definitions are refused for unknown or repeated capabilities, unbounded budgets, malformed scopes, and a direct agent on a command without a UI binding.
- `test/tool-envelope.test.ts`: every `$ref` of a wrapped recursive schema resolves from its root, and only commands other than `approval.request` are offered `expectedRevisions`.
- `test/contracts.test.ts`: rejects a capability without a UI binding or declared exception, duplicates, cycles, unresolved workflows, colliding MCP names and invalid requirements.
- `test/os.test.ts`: catalog output, refused paths, templates, prefill targets and payload limits, duplicate claims, refused open URLs, and notify actions with reply handlers and outbox targets.

## Skills

- [add-capability](../runtime/skills/add-capability/SKILL.md): commands, queries, policy, record shapes and triggers.
- [connect-system-of-record](../integration/skills/connect-system-of-record/SKILL.md): targets, outbox settlement, sync and live reads.
- [add-os-integration](../shell/skills/add-os-integration/SKILL.md): OS handlers, actions and native registrations.
