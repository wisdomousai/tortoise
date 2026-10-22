# @agent-native/sample-notes-agents

`sample-notes-agents` composes the [notes sample](../notes/README.md) unchanged with agents. The `note.titler` agent and a trigger suggest titles for untitled notes as [approval requests](../../docs/glossary.md#approval-request), and a person approves or rejects each one. A run started from the note screen sends UI intents (see [UI session context](../../docs/primitives.md#ui-session-context)) back to that screen.

## Layer

Content (`samples/*`). It imports the base sample, the framework and `@agent-native/automation`.

## Primitives

The sample is one [application](../../docs/primitives.md#application). Its own files:

| File | Runs in | Holds |
| --- | --- | --- |
| `contracts.ts` | Browser and server | The `note-titles` module: the approval operations and the `note.titler` [agent definition](../../docs/primitives.md#agent-definition), whose output is `request-approval` |
| `domain.ts`, `title.ts` | Server; `title.ts` also browser | The `titles` slice that holds approval requests, and the title taken from a note's first line |
| `handlers.ts` | Server | `approvalHandlers` over the `titles` slice. Only `note.update` may be requested |
| `policy.ts` | Server | The route for the `note-titles` module. It selects the whole state, so its rules read the base sample's members |
| `automation.ts` | Server | The `title-new-notes` [trigger](../../docs/primitives.md#trigger) and its job |
| `application.ts` | Server | The base handlers in the `notes` slice, the approval handlers, both routes, `selectableResources` and the automation plugin |
| `screens.tsx`, `ui/titles.tsx` | Browser | The base note screen with a title section, the approvals list, the automation screen and `resources` |

The trigger reacts to `note.add`. Its job reads the note and, when the title is empty, requests approval for `note.update` with the first line of the text. It runs as the person who issued its [standing grant](../../docs/primitives.md#standing-grant), narrowed to `note.get` and `approval.request`, so it never changes a note. It is a deterministic job, so a dev launch needs no model.

The note screen registers the open note as the [UI session context](../../docs/primitives.md#ui-session-context), because `note` is a selectable resource. **Suggest a title (offline run)** starts a deterministic run that requests approval for the title and then calls `ui.request-review`; the screen shows the review above the pending suggestions. `screens.resources` maps `note` and `approval-request` to the screens an `ui.open` intent leads to.

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/sample-notes-agents/manifest` | Browser and server | The notes module, the note-titles module and the automation plugin manifest |
| `@agent-native/sample-notes-agents/application` | Server | `createNotesAgentsApplication` |
| `@agent-native/sample-notes-agents/screens` | Browser | The note screens with title suggestions, approvals and automation |

## Trust boundary

Any member may request approval. Approving needs a person and runs `note.update` as the approver, so the base sample's policy refuses a viewer's approval and the request stays pending. Rejecting and expiring need an editor. The titler's grant leaves out `note.update` itself, so a run that tries to change a note directly is refused.

A run reaches the screen only through the `ui.*` run tools, and only for the UI session it captured when it started. Each intent is checked under the run's own grant: a resource it cannot read, or a kind that is not selectable, is refused and never reaches the screen. Intents change no records.

## Dependencies

`@agent-native/sample-notes`, `@agent-native/automation`, `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/frame`, and in tests `@agent-native/agents` and `@agent-native/testing`.

## Tests

```sh
bun test samples/notes-agents
```

- `test/automation.test.ts`: the trigger does nothing before a grant. After it, an untitled note gets an approval request from an `auto:` run and a titled note gets none. A viewer's approval is refused and leaves the request pending, an editor's approval sets the title, and after revoking no request is made.
- `test/agent-scenarios.test.ts`: `runAgentScenarios` with the deterministic harness. The titler requests approval and commits nothing, and its direct `note.update` is refused.
- `test/ui-intents.test.ts`: a run started from a UI session requests approval, opens the note and asks for a review naming the approval request, and the screen's poll receives both intents. A missing note and an unselectable kind are refused.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen in this sample, the base or the automation plugin.

Run the sample in the browser:

```sh
cd samples/notes-agents
bun run dev:web
```

Enable the trigger on the Automation screen and add a note without a title to see a suggestion appear. On a note without a title, **Suggest a title (offline run)** starts the run from the screen.

## Skills

- [add-capability](../../packages/runtime/skills/add-capability/SKILL.md)
- [build-screens](../../packages/frame/skills/build-screens/SKILL.md)

## References

- [Samples](../../docs/samples.md)
- [Agents](../../docs/agents.md)
- [Automation plugin](../../plugins/automation/README.md)
