# Author a capability

A capability connects one domain behavior to the catalog and runtime. The `project-tasks` example is the worked reference: its contracts, server, policy and domain tests.

## 1. Define the contract

The contract is browser-safe data with a stable ID and explicit schemas:

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

## 2. Implement the handler

The handler lives in a server entrypoint and is typed by its capability:

```ts
import { createHandlerFactory } from '@agent-native/runtime';
import { ApplicationError } from '@agent-native/contracts';
import { rename } from './contracts';

type State = { notes: Record<string, { id: string; title: string }> };
const handler = createHandlerFactory<State, {}>();
export const renameHandler = handler(rename, (input, ctx) => {
  // IDs are untrusted input; inherited properties are never records.
  const note = Object.hasOwn(ctx.state.notes, input.id) ? ctx.state.notes[input.id] : undefined;
  if (!note) throw new ApplicationError('NOT_FOUND', 'Note unavailable');
  note.title = input.title;
  ctx.change(`note:${note.id}`);
  return { id: note.id, title: note.title };
});
```

How state is represented is up to the feature. It can wrap transaction-bound state in its own repositories and receive domain services through `services`. The kernel needs no universal record table.

For keyed records, declare a [collection](primitives.md#collection) and use its records helper. It does the own-property lookup, the `NOT_FOUND` and the change declaration:

```ts
import { defineCollection, collectionList } from '@agent-native/contracts';
import { records, collectionListHandler } from '@agent-native/runtime';

export const noteRecords = defineCollection({
  type: 'note',
  resourceType: 'note',
  item: noteSchema,
});
export const listNotes = collectionList(noteRecords, {
  id: 'note',
  filters: ['folder'],
  description: '…',
});

// In a command handler: records(ctx, noteRecords, ctx.state.notes).update(input.id, { title: input.title });
// For the list: collectionListHandler(noteRecords, listNotes, { store: (s) => s.notes, visible: canSee });
```

- **Declare every change.** Each state change is declared with `ctx.change`, and an undeclared change fails. Use expected revisions for updates that depend on what the caller saw.
- **No network calls inside a transaction.** Work that needs another system either happens before the command, as an authorized read or computation, or after it as a durable intent. Use `ctx.enqueue` on a changed resource, let the dispatcher deliver it, and record the outcome with a settle command under the integration principal ([systems of record](system-of-record-pattern.md)). Declare the outbox integration on the capability, so the generated docs say that a receipt is not acceptance. The `quality-inspection` example shows the full loop.
- **Errors.** Use `ApplicationError` with details that are safe to show the caller.

## 3. Compose it

Add the module to the application's manifest and the handler to its application definition. The host builds the runtime from that definition, so no host or starter file changes. Tests compose the same definition directly.

Policy decides operation, resource, current and proposed fields, and grant scope, and list queries are scoped before paging. The runtime rechecks authorization and cancellation before commit, validates the projected output, and persists everything atomically. A policy change either calls `ctx.invalidateAuthorization()` or declares an authorization event. See [authorization](authorization.md).

Protected output fields are optional or modeled as explicit view variants, so a projected result still validates. A replayed receipt is projected again under current access.

## 4. Declare what it reaches

A module declares its network destinations, devices and child processes, each with purpose, data classes, availability and offline behavior. An outbox target needs a destination that queues while offline. Input fields that are safe to record in plain text are listed for the audit log, and everything else is recorded as a digest. Server code reaches the network only through the egress guard. After `bun run generate`, review the change in the application's generated security manifest and data flows ([security and compliance](security-and-compliance.md)).

## 5. Bind it to a screen

Use the typed client with a matching UI binding. The React bindings provide live query options and a capability form that keeps one idempotency key until the command commits. The catalog checks that bindings are declared, but whether they actually render needs a UI test. Add workflow text when agents need a sequence of operations, and declare any surface that intentionally lacks the operation.

## 6. Prove it

Write a behavioral scenario that covers allowed and denied access, stale revisions, idempotency and visible changes, and run it through the direct driver and each transport. Then run the checks in [development and testing](development-and-testing.md). Record browser and native results separately.
