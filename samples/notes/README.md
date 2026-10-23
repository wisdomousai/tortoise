# @agent-native/sample-notes

`sample-notes` is the base application of the [samples](../../docs/samples.md): a workspace of notes that editors add and change and viewers read. Each extension sample imports its module, handlers, policy and screens unchanged and adds one concern next to them.

## Layer

Content (`samples/*`). It composes no plugins, and it trusts only the framework.

## Primitives

The sample is one [application](../../docs/primitives.md#application). It composes:

- one [module](../../docs/primitives.md#module), `notes`, with a [collection](../../docs/primitives.md#collection) of notes, the generated `note.list` and `note.get` [queries](../../docs/primitives.md#query), and the `note.add` and `note.update` [commands](../../docs/primitives.md#command);
- a workflow, `notes.edit`, that the MCP resource `app://workflows/notes.edit` and the generated application skill serve to agents;
- a [policy](../../docs/primitives.md#policy) with editor and viewer roles, applied to the `notes` state slice through `composeAuthorization`;
- [capability bindings](../../docs/primitives.md#capability-binding): the frame's `CollectionScreen` and `RecordScreen` over the generated reads, which follow them as [live queries](../../docs/primitives.md#journal-and-live-query).

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/sample-notes/manifest` | Browser and server | `defineManifest` with the `notes` module |
| `@agent-native/sample-notes/application` | Server | `createNotesApplication`, the `notes` slice, handlers and policy |
| `@agent-native/sample-notes/screens` | Browser | The note list and the note screen |
| `@agent-native/sample-notes/server` | Server | What an extension imports: module, handlers, policy and state |
| `@agent-native/sample-notes/ui/notes` | Browser | `noteRoutes({ sections })`, `noteNavigation` and `noteCapabilityScreens` |

## Trust boundary

The policy's caller gate admits only principals listed in `members`. `note.add` and `note.update` need the editor role, and every other operation is denied. A change that passes `expectedRevisions` older than the note's revision fails with `CONFLICT` inside the transaction.

## Dependencies

`@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host` and `@agent-native/frame`.

## Tests

```sh
bun test samples/notes
```

- `test/notes.test.ts`: behavioral scenarios through `directDriver` on the embedded instance. They cover adding and changing a note, a stale revision, a replayed idempotency key and refused callers.
- `test/headless.test.ts`: the starter's CLI adds and lists notes with `--embedded`, and an MCP client lists one tool per capability, reads the workflow and calls `note_add`.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen.

Run the sample in the browser:

```sh
cd samples/notes
bun run dev:web
```

## Skills

- [add-capability](../../packages/runtime/skills/add-capability/SKILL.md)
- [build-screens](../../packages/frame/skills/build-screens/SKILL.md)

## References

- [Samples](../../docs/samples.md)
- [Capability authoring](../../docs/capability-authoring.md)
- [Interaction contract](../../docs/interaction-contract.md)
- [Authorization](../../docs/authorization.md)
