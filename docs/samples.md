# Samples

The [samples](glossary.md#sample) in `samples/*` are small applications on one notes domain. `samples/notes` is the base application. Each other sample imports the base's module, handlers, policy and screens unchanged and adds one concern next to them.

## Concepts

Terms: [sample](glossary.md#sample), [application](glossary.md#application), [module](glossary.md#module), [policy](glossary.md#policy), [display metadata](glossary.md#display-metadata) and [UI intent](glossary.md#ui-intent).

## Base application

| File | Holds |
| --- | --- |
| `samples/notes/contracts.ts` | The `notes` module: the note collection with its display metadata, `note.add` and `note.update` |
| `samples/notes/domain.ts`, `handlers.ts`, `policy.ts` | The `notes` state slice, the handlers and the editor and viewer policy |
| `samples/notes/server.ts` | What an extension imports on the server |
| `samples/notes/ui/notes.tsx` | The note routes, navigation and capability screens that an extension spreads |
| `samples/notes/application.ts`, `manifest.ts`, `screens.tsx` | The three entrypoints of the base application on its own |

The base keeps its state in a `notes` slice from the start, so an extension adds a slice beside it instead of moving it.

## Composition

An extension sample composes the base in each entrypoint:

- **Manifest:** the base's `notesModule` next to the extension's module or plugin manifests.
- **Handlers:** `sliceHandlers('notes', createNotesHandlers())` runs the base handlers on the `notes` slice. The extension's own handlers are typed on the whole state, so they can read notes.
- **Authorization:** `composeAuthorization` routes each module to its policy. The base route sees only the `notes` slice. An extension route that needs the base's members selects the whole state.
- **Screens:** the extension spreads `noteRoutes({ sections })`, `noteNavigation` and `noteCapabilityScreens`. A section is a component that the note screen renders below the note, so an extension adds a panel without editing the base.

| Sample | Port | Concern | Framework parts it composes |
| --- | --- | --- | --- |
| `notes` | 4350 | Collections, roles, revisions, idempotency, live queries, CLI and MCP without screens | `defineCollection`, `definePolicy`, `CollectionScreen`, `RecordScreen` |
| `notes-system-of-record` | 4351 | A REST publisher: outbox, settlement, a held effect, inbound sync | `defineTarget`, `connectTarget`, `httpTargetPort`, `reconciliationHandlers` |
| `notes-agents` | 4352 | Title suggestions as approval requests, a trigger, UI intents from a run | `defineAgent`, `approvalHandlers`, `defineTrigger`, `useUiSession` |
| `notes-host-plugin` | 4353 | An `activity` host plugin written in the sample | `definePluginManifest`, `defineHostPlugin`, `definePluginScreens` |
| `notes-operations` | 4354 | A versioned state migration and telemetry on a site | `StateMigrations`, the site, network, audit and telemetry plugins |

Each sample's README lists its files, its trust boundary and one line per test file.

## Use

Run a sample in the browser from its directory:

```sh
cd samples/notes-agents
bun run dev:web
```

Run the tests of one sample, or of all of them:

```sh
bun test samples/notes-agents
bun test samples
```

A sample with a `dev.ts` starts its fake system first. `notes-system-of-record` starts a fake publisher on port 4361. `notes-operations` expects an OpenTelemetry Collector on port 4318.

## Limits

- No sample serves a local model or runs agent tools in the execution host. The model-server stand-in is exported only from that plugin's tests, and the execution host runs only on Linux with bubblewrap.
- No sample reads plant signals.
- The samples have no Playwright specs. `bun run check` runs their behavioral and UI-binding tests.

## References

- [Notes](../samples/notes/README.md)
- [Notes system of record](../samples/notes-system-of-record/README.md)
- [Notes agents](../samples/notes-agents/README.md)
- [Notes host plugin](../samples/notes-host-plugin/README.md)
- [Notes operations](../samples/notes-operations/README.md)
- [Architecture](architecture.md)
- [Capability authoring](capability-authoring.md)
