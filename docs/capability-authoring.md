# Capability authoring

Domain behavior enters an application as a capability, written from the contract through the handler and policy rule to the tests. The `project-tasks` example is the worked reference.

## Concepts

- [Capability](glossary.md#capability): a command or query declared once as data.
- [Module](glossary.md#module): the unit that groups capabilities, handlers and a state slice.
- [Handler](glossary.md#handler): the server code that implements one capability.
- [Collection](glossary.md#collection): a typed set of keyed records with generated reads.
- [State migration](glossary.md#state-migration): numbered steps between stored state shapes.
- [Behavioral scenario](glossary.md#behavioral-scenario): a reusable test of one capability.

## Contract

The contract is browser-safe data with a stable operation ID and explicit schemas. The [interaction contract](interaction-contract.md) gives the schema rules.

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

Make protected output fields optional or model explicit output variants, so a result that [policy](glossary.md#policy) projected still validates.

## Handler

The handler lives in a server entrypoint and is typed by its capability.

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

The module decides how its state is represented. A handler can wrap the transaction's state in its own repositories and receive domain services through `services`. The composition needs no universal record table.

A handler declares each changed resource with `ctx.change`, and the runtime assigns its [revision](glossary.md#revision) and [journal](glossary.md#journal) entry. A command that changes state but declares no changed resource fails. An effect or blob reference on an undeclared resource fails too, and so does a query that changes state.

A handler makes no network call inside the transaction. It reads what it needs before the command, or enqueues an [outbox effect](glossary.md#effect) with `ctx.enqueue`. Declare the integration on such a capability, so the generated reference says that a [receipt](glossary.md#receipt) is not acceptance by the target. [Systems of record](systems-of-record.md) explains delivery and settlement, and the quality inspection example shows the full loop.

A handler reports a failure with `ApplicationError`, whose message and details must be safe to show the [caller](glossary.md#caller).

A command that changes access calls `ctx.invalidateAuthorization()` or declares a change of type `authorization.changed`. Either increments the authorization revision in the same transaction.

## Collections

For keyed records, declare a collection and use its records helper, which does the own-property lookup, raises `NOT_FOUND` and declares the change.

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

## Composition

Add the module to the application's [manifest](glossary.md#manifest) and the handler to its [application definition](glossary.md#application-definition). The host builds the [authority](glossary.md#authority) from that definition, so no host or starter file changes. Tests compose the same definition directly.

Write the policy rule for the operation, the object, current and proposed fields, and the [grant](glossary.md#grant) scope; [authorization](authorization.md) explains where each check runs. [State and reactivity](state-and-reactivity.md) lists the steps of a command.

## Requirement declarations

A module declares what it reaches outside the process as [requirement declarations](glossary.md#requirement-declaration):

- network destinations, each with a purpose, data classes, availability and offline behavior;
- exchange folders, each with a purpose, access and data classes;
- devices and child processes, each with a purpose and availability.

A network destination that carries an outbox target must queue while offline. Server code reaches the network only through the [egress guard](glossary.md#egress-guard). A capability's `audit` field lists the input fields safe to record in plain text; the [audit log](glossary.md#audit-log) records the rest as digests. After `bun run generate`, review the generated security manifest and data flows. [Security and compliance](security-and-compliance.md) explains how a deployment policy binds the declarations.

## Screen binding

Bind the capability to a [screen](glossary.md#screen) through the typed client. The [interaction contract](interaction-contract.md) describes UI bindings and workflow text.

## Record shape changes

When a stored record shape changes, add a step to the application's `StateMigrations` instead of reading both shapes in the handler. A step must be deterministic, because storage runs it on every load until a commit persists the result. The [`packages/kernel`](../packages/kernel/README.md) README describes versions and compatible steps.

## Triggers

A [trigger](glossary.md#trigger) runs a job or an agent definition on a committed change or a schedule. Declare it with `defineTrigger` from [`plugins/automation`](../plugins/automation/README.md). Each run acts as the issuer of the trigger's [standing grant](glossary.md#standing-grant), narrowed to the trigger's operations, and its commands are authorized like any caller's. [Agents](agents.md) explains runs and standing grants.

## Scenarios

Write a behavioral scenario for each capability: permitted and denied access, a stale revision, a replayed [idempotency key](glossary.md#idempotency-key) and the change visible to another caller. [`packages/testing`](../packages/testing/README.md) runs it against the authority directly. `examples/project-tasks/test/transport-conformance.test.ts` checks the same behavior over HTTP, the CLI and MCP. When an agent definition gains or loses a capability, update its [agent scenarios](glossary.md#agent-scenario).

## Use

In an application made by the [scaffold](glossary.md#scaffold), this command writes the contract, handler, policy rule and a test at the `// scaffold:` markers.

```sh
bun run scaffold add capability note.archive --kind command --description "Archive a note"
```

Then run the checks in [development and testing](development-and-testing.md), and record browser and native runs in the [implementation ledger](implementation-status.md). The [add-capability](../packages/runtime/skills/add-capability/SKILL.md) skill lists these steps for a coding agent.

## Related pages

[Interaction contract](interaction-contract.md), [state and reactivity](state-and-reactivity.md), [authorization](authorization.md) and [systems of record](systems-of-record.md).
