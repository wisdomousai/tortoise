# Capability authoring

A capability is one command or query. You write four things: a contract, a handler, a policy rule and a test. In a scaffolded app one command writes all four at the `// scaffold:` markers:

```sh
bun run scaffold add capability inspection.approve --kind command --description "Approve an inspection"
```

Then fill them in as below and run the checks in [development and testing](development-and-testing.md).

## Contract

Browser-safe data: a stable ID and explicit schemas.

```ts
import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@tortoise/contracts';

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

Make protected output fields optional, so output the policy trimmed still validates.

## Handler

Server-only, with types from its capability.

```ts
import { createHandlerFactory } from '@tortoise/runtime';
import { ApplicationError } from '@tortoise/contracts';
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

Rules:

- Declare every changed resource with `ctx.change`; the runtime assigns its revision and journal entry. A command that changes state without it fails, and so does a query that changes state.
- No network calls inside the transaction. Read first, or enqueue an outbox effect with `ctx.enqueue` and declare the integration.
- Fail with `ApplicationError`; the caller sees its message.
- A command that changes access calls `ctx.invalidateAuthorization()`.

## Nested calls

Use `ctx.invoke` (or `ctx.query`) when another operation's writes must commit in the same transaction. List the callee in `invokes`. (`invokeRaw` with `invokes: 'any'` runs an operation named in the input.)

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

The runtime authorizes and validates each nested call as its own operation, under your context, and its changes count as yours. The runtime refuses an unlisted operation, depth over 4, more than 64 calls, re-entry, parallel or dangling calls, and a query that invokes a command. A refused nested call fails the whole command, even if you catch it.

## Declared workflows

Use `defineWorkflow` when steps wait on people or systems of record. List it in the module's `workflows` and compose the [workflows plugin](../plugins/workflows/README.md).

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

Bindings: `from.input`, `from.step` (earlier result), `from.effect` (an awaited effect's outcome), `from.result` (in a wait). The catalog refuses reading ahead, a wait without `watch` or `recheckMs`, and out-of-range durations. Each step runs as the person who started the workflow. To start one from a command, list `workflow.start` in `invokes` and pass a business `key`; one instance runs per key.

## Choosing a composition

| Use | When |
| --- | --- |
| Nested call | Both writes commit together, in one transaction. |
| Declared workflow | Steps span minutes to weeks, wait on people or outbox outcomes, and need compensation. |
| Trigger | Work starts on a committed change or a schedule, with no sequence. |

## Collections

For keyed records, use a collection. Its `records` helper does the lookup, `NOT_FOUND` and `ctx.change` for you.

```ts
import { defineCollection, collectionList } from '@tortoise/contracts';
import { records, collectionListHandler } from '@tortoise/runtime';

export const noteRecords = defineCollection({
  type: 'note',
  resourceType: 'note',
  item: noteSchema,
});
export const listNotes = collectionList(noteRecords, {
  id: 'note',
  filters: ['folder'],
  sort: ['title', 'createdAt'],
  description: '…',
});

// In a command handler: records(ctx, noteRecords, ctx.state.notes).update(input.id, { title: input.title });
// For the list: collectionListHandler(noteRecords, listNotes, { store: (s) => s.notes, visible: canSee });
```

A list's `filters` are equality filters on item fields; each becomes an optional input. `sort` names the fields a caller may order by and adds the optional inputs `sortBy` and `sortDirection`; the handler's own `order` applies without `sortBy` and breaks ties. `search` adds a text input the handler matches with `searchText`. The generated list screen renders each of these as a control, and an agent gets them as tool parameters.

`collectionUpdate` makes every listed field optional, so a call changes only the fields it names. A field the item may leave out also accepts `null`, which removes it from the record; a required item field does not.

The collection's `fields` carry display metadata for generated screens and tools: a `label`, a `kind` (`text`, `date`, `date-time`, `status`, `reference`, `file`), `tones` for a status field's values (`neutral`, `positive`, `warning`, `negative`) and, for a reference, the resource kind of the collection it names. Without a kind, the screens infer one from the field's name and schema: a field named like a timestamp shows as a date, a `status` enum as a badge, a blob reference as a file.

## Wire it up

- Add the module to the manifest and the handler to the application definition. No host file changes.
- Add the policy rule ([authorization](authorization.md#write-a-policy)).
- Bind it to a screen through the typed client.
- Declare anything outside the process as requirement declarations: network destinations, exchange folders, devices, child processes. Outbox destinations must queue offline. List plain-text-safe input fields in `audit`; the audit log keeps the rest as digests. Review the security manifest after `bun run generate`.
- Changed a stored record shape? Add a deterministic step to `StateMigrations` instead of reading both shapes.
- Need it on a change or schedule? Use `defineTrigger` from [`plugins/automation`](../plugins/automation/README.md); it runs under the trigger grant.

## Scenarios

Test each capability for: allowed and denied access, a stale revision, a replayed idempotency key, and the change visible to another caller. [`packages/testing`](../packages/testing/README.md) runs scenarios against the instance; `showcase/examples/field-service/test/transport-conformance.test.ts` repeats them over HTTP, CLI and MCP. Update agent scenarios when an agent gains or loses a capability.

## See also

[Interaction contract](interaction-contract.md) · [State and reactivity](state-and-reactivity.md) · [Systems of record](systems-of-record.md) · [`packages/kernel`](../packages/kernel/README.md) · [Agents](agents.md) · [add-capability skill](../packages/runtime/skills/add-capability/SKILL.md)
