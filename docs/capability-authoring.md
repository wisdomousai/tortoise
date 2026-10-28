# Capability authoring

A [capability](glossary.md#capability) is a command or query declared once. Authoring one capability follows this order:

1. the contract
2. the handler
3. the policy rule
4. the tests

The `field-service` example is the worked reference.

## Concepts

Terms: [capability](glossary.md#capability), [module](glossary.md#module), [handler](glossary.md#handler), [collection](glossary.md#collection), [state migration](glossary.md#state-migration) and [behavioral scenario](glossary.md#behavioral-scenario).

## Contract

The contract is browser-safe data with a stable operation ID and explicit schemas.

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

The module decides how its state is represented. A handler can wrap the transaction's state in its own repositories and receive domain services through `services`.

A handler declares each changed resource with `ctx.change`, and the runtime assigns its [revision](glossary.md#revision) and [journal](glossary.md#journal) entry. A command that changes state but declares no changed resource fails. An effect or blob reference on an undeclared resource fails too, and so does a query that changes state.

A handler makes no network call inside the transaction. It reads what it needs before the command, or enqueues an [outbox effect](glossary.md#effect) with `ctx.enqueue`. Declare the integration on such a capability, so the generated reference says that a [receipt](glossary.md#receipt) is not acceptance by the target.

A handler reports a failure with `ApplicationError`, whose message and details must be safe to show the [caller](glossary.md#caller).

A command that changes access calls `ctx.invalidateAuthorization()` or declares a change of type `authorization.changed`. Either increments the authorization revision in the same transaction.

## Nested calls

A command whose writes must commit together with another operation's runs that operation inside its own transaction. The capability lists what it calls in `invokes`, and the handler calls `ctx.invoke` or `ctx.query` with the imported capability, so input and output are typed. `invokeRaw` and `queryRaw` take an operation ID and suit a command that runs whatever its input names, declared with `invokes: 'any'`.

```ts
export const linkAndExtract = operation('capture.link-and-extract', 'command', {
  // ...
  invokes: ['assignment.report.link', 'assignment.extraction.create'],
});

handler(linkAndExtract, async (input, ctx) => {
  const capture = await ctx.invoke(reportLink, { id: input.id, subject: input.nodeId });
  const extraction = await ctx.invoke(extractionCreate, {
    title: 'Read the nameplate',
    scope: { reportId: input.id },
    assignee: { type: 'target', id: 'model' },
  });
  return { capture, extraction };
});
```

Each call takes the whole command path for its operation under the caller's context: grant, policy with `via`, expected revisions, handler, projection, its own blob limits and the commit-phase policy. Its changes and effects count as the caller's. A nested query reads the writes made so far. The runtime refuses:

- an operation the capability does not list;
- a chain deeper than 4, more than 64 calls in one command, and a call that reaches an operation already running;
- two calls at once, and a call still running when the handler returns;
- a query that invokes a command, and a nested remote query.

A refused call fails the command even when the handler catches the error. The catalog refuses an unknown target, a query that invokes a command, a cycle and a chain deeper than 4. An operation's destinations include those of what it invokes, and the grants of agents and job triggers that list it cover them.

Use a nested call when both writes must commit together as one caller; see [choosing a composition](#choosing-a-composition) for the alternatives.

## Declared workflows

A sequence that waits on people or systems of record between its steps is a declared [workflow](glossary.md#workflow). `defineWorkflow` lists its steps, the module lists it in `workflows`, and the application composes the [workflows plugin](../plugins/workflows/README.md) to run it.

```ts
export const captureToEam = defineWorkflow({
  id: 'survey.capture-to-eam',
  version: 1,
  text: 'Link a capture, request its extraction, wait for review, then file and export the node.',
  input: jsonSchema(z.strictObject({ captureId: recordId, nodeId: recordId })),
  maxDurationMs: 2 * WEEK,
  start: 'capture.file-workflow',
  steps: [
    step.run('link', 'capture.link', {
      input: { id: from.input('captureId'), nodeId: from.input('nodeId') },
    }),
    step.wait('reviewed', 'capture.get', {
      input: { id: from.input('captureId') },
      watch: ['capture'],
      until: { equals: [from.result('review'), 'reviewed'] },
      timeoutMs: WEEK,
    }),
    step.run('file', 'filing.file', {
      input: { nodeId: from.input('nodeId') },
      await: 'effects',
      compensate: { command: 'filing.withdraw', input: { id: from.step('file', 'id') } },
    }),
  ],
});
```

Bindings read the input (`from.input`), an earlier step's result (`from.step`), the outcome of an effect an earlier step awaited (`from.effect`) and, in a wait's condition, the query result (`from.result`). The catalog refuses a binding that reads ahead, a wait with neither `watch` nor `recheckMs`, a step that reaches a `workflow.*` operation, an unbound required input and durations out of range.

Each step runs as the starter inside its own `workflow.advance` command, so it passes the application's policy as that person when it runs. A command that starts the workflow for its callers lists `workflow.start` in `invokes` and calls it with a business `key`, which admits one running instance per key.

## Choosing a composition

- A nested call: both writes must commit together, as one caller, in one transaction.
- A declared workflow: steps follow each other over minutes to weeks, wait on a person or an outbox outcome, and a later failure undoes earlier steps.
- A [trigger](glossary.md#trigger): work starts on a committed change or a schedule, under a person's trigger grant, with no sequence to keep.

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

Add the module to the application's [manifest](glossary.md#manifest) and the handler to its [application definition](glossary.md#application-definition). The host builds the [instance](glossary.md#instance) from that definition, so no host or starter file changes. Tests compose the same definition directly.

Write the policy rule for the operation, the object, current and proposed fields, and the [grant](glossary.md#grant) scope.

## Requirement declarations

A module declares what it reaches outside the process as [requirement declarations](glossary.md#requirement-declaration):

- network destinations, each with a purpose, data classes, availability and offline behavior;
- exchange folders, each with a purpose, access and data classes;
- devices and child processes, each with a purpose and availability.

A network destination that includes an outbox target must queue while offline. Server code reaches the network only through the [egress guard](glossary.md#egress-guard). A capability's `audit` field lists the input fields safe to record in plain text; the [audit log](glossary.md#audit-log) records the rest as digests. After `bun run generate`, review the generated security manifest and data flows.

## Screen binding

Bind the capability to a [screen](glossary.md#screen) through the typed client.

## Record shape changes

When a stored record shape changes, add a step to the application's `StateMigrations` instead of reading both shapes in the handler. A step must be deterministic, because storage runs it on every load until a commit persists the result.

## Triggers

A [trigger](glossary.md#trigger) runs a job or an agent definition on a committed change or a schedule. Declare it with `defineTrigger` from [`plugins/automation`](../plugins/automation/README.md). Each run acts as the issuer of the trigger's [trigger grant](glossary.md#trigger-grant), narrowed to the trigger's operations, and its commands are authorized like any caller's.

## Scenarios

Write a behavioral scenario for each capability: permitted and denied access, a stale revision, a replayed [idempotency key](glossary.md#idempotency-key) and the change visible to another caller. [`packages/testing`](../packages/testing/README.md) runs it against the instance directly. `showcase/examples/field-service/test/transport-conformance.test.ts` checks the same behavior over HTTP, the CLI and MCP. When an agent definition gains or loses a capability, update its [agent scenarios](glossary.md#agent-scenario).

## Use

In an application made by the [scaffold](glossary.md#scaffold), this command writes the contract, handler, policy rule and a test at the `// scaffold:` markers.

```sh
bun run scaffold add capability inspection.approve --kind command --description "Approve an inspection"
```

Then run the checks in [development and testing](development-and-testing.md), and record browser and native runs in the [implementation ledger](implementation-status.md).

## References

- [Interaction contract](interaction-contract.md)
- [State and reactivity](state-and-reactivity.md)
- [Authorization](authorization.md)
- [Systems of record](systems-of-record.md)
- [Security and compliance](security-and-compliance.md)
- [`packages/kernel`](../packages/kernel/README.md)
- [Agents](agents.md)
- [add-capability](../packages/runtime/skills/add-capability/SKILL.md)
