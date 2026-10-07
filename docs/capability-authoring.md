# Author a capability

Capability authoring connects one domain behavior to the catalog and runtime. The worked reference is `examples/project-tasks/contracts.ts`, `server.ts`, `policy.ts` and `domain.test.ts`; start there when changing the example.

Define the browser-safe contract with a stable ID and explicit schemas:

```ts
import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@agent-native/contracts';

export const rename = defineCapability({
  id: 'note.rename',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string(), title: z.string().min(1) })),
  output: jsonSchema(z.strictObject({ id: z.string(), title: z.string() })),
  permission: { action: 'update', resourceType: 'note' },
  ui: { binding: 'note.rename' },
});
export const notes = defineModule({ id: 'notes', capabilities: [rename] });
```

Keep the executable implementation in a server entrypoint. Bind its types without widening IDs or casting handler arguments:

```ts
import { createHandlerFactory } from '@agent-native/runtime';
import { ApplicationError } from '@agent-native/contracts';
import { rename } from './contracts';

type State = { notes: Record<string, { id: string; title: string }> };
const handler = createHandlerFactory<State, {}>();
export const renameHandler = handler(rename, (input, ctx) => {
  // Dictionary IDs are untrusted; inherited properties are never domain records.
  const note = Object.hasOwn(ctx.state.notes, input.id) ? ctx.state.notes[input.id] : undefined;
  if (!note) throw new ApplicationError('NOT_FOUND', 'Note unavailable');
  note.title = input.title;
  ctx.change(`note:${note.id}`);
  return { id: note.id, title: note.title };
});
```

For safe domain errors use `ApplicationError` with caller-safe details. The example state representation is a feature choice. Production features may wrap transaction-bound state in their own repositories and inject domain services through `services`; the kernel requires no universal business-record table. Memory storage supports cloneable feature state. The reference SQLite snapshot adapter stores JSON-compatible state, and is replaceable behind `Storage<State>`.

Compose `createApplication({ modules: [notes], handlers: [renameHandler], storage, authorization, services: {} })` in the host. Supply a trusted execution context from the identity/session adapter. The authorization port must check operation, actual resource, current/proposed fields and resource-grant scope; list queries scope before pagination/counting. The runtime rechecks authorization and cancellation before committing, validates the authorized output DTO, then atomically persists state, revisions, receipt and journal. Call `ctx.invalidateAuthorization()` for policy changes or declare an `authorization.changed` resource event. Persistent run revocation belongs in the host authorization check; an abort signal cancels current work but does not undo committed commands.

Every feature-state mutation declares its changed resources through `ctx.change`; undeclared mutations fail instead of producing invisible writes. Use request `expectedRevisions` for updates based on observed state. UI drafts remain separate from committed queries, and conflicts require reconciliation. Do not call a provider or network service while a transaction is held. External preparation may perform authorized reads or computation before a command; it must not make an unaudited business write before command authorization. For external business effects, use the [durable intent and outcome pattern](task-workflow-pattern.md): call `ctx.enqueue({ target, type, payload, resource })` on a declared changed resource, let the `packages/integration` dispatcher deliver it outside the transaction, and record the outcome in a domain settle command that calls `ctx.settleEffect` under the integration principal. Declare `integration: { target, delivery: 'outbox' }` on the capability so generated docs and MCP annotations state that a receipt is not acceptance. `examples/quality-inspection/server.ts` is the worked reference.

Protected output fields must be optional or represented through explicit public view variants. `projectOutput` filters by current permissions, and the final DTO must validate against the output schema. Removing a required field fails and rolls back the command. Replayed receipts are projected again under current access.

Add the React action/live query against the typed client, with a matching UI binding declaration. TanStack-based screens use `live.liveQueryOptions(capability, input)` and `useCapabilityForm(transport, capability, …)`, which reuses one idempotency key per form until it commits. The runtime catalog verifies declaration coverage; actual binding and rendering need UI checks. Add workflow text referencing canonical IDs when agent users need a sequence, and document intentional headless exceptions. MCP/API/CLI handlers must dispatch through the runtime rather than reimplementing behavior.

Add a reusable behavioral scenario for allowed behavior, denied access, stale revisions/idempotency and committed change visibility. Run it through the direct driver and applicable transports. Then run focused tests, `bun run typecheck`, `bun run generate`, `bun run check:generated` and `bun run check:boundaries`. Verify browser/native behavior separately and record those results accurately.
