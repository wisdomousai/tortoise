---
name: build-screens
description: Build or change the web screens of an agent-native application, feature or host plugin. Use when adding a route, list or record screen, form, capture or workstation screen, navigation item or capability screen; when a screen shares its selection with agent runs or handles their UI intents; when pulling or changing an item of the tortoise or operator shadcn registry; or when replacing a frame file in the starter. Covers showcase/examples/<app>/screens.tsx, showcase/examples/<app>/ui, showcase/patterns/<name>/ui, packages/frame, packages/react, packages/operator-ui and apps/web.
---

# Build screens

Screens are the browser half of an application. They read through live queries and write only through catalog commands.

## Before writing

- Start from a UI registry item before writing a component. The items live in `packages/frame/src/components`:
  - `collection-screen` builds list and record screens from a collection's generated capabilities;
  - `collection-tree` shows a tree collection's generated `tree` read with search over its `list`;
  - `capability-form` renders any command;
  - `live-data-table` pages after the instance scopes rows.
- Declare display metadata on the capability before writing columns or labels in a screen. `collection-screen`, `capability-form` and the command palette read it. A collection passes it as `titleField` and `fields`; each field takes a `label` and a `kind` (`date`, `date-time`, `status` with `tones`, `reference` with the resource kind, `file`). Declare `filters`, `sort` and `search` on the list, and the generic screen renders them. It formats dates, badges a status and shows a reference by its title through `packages/frame/src/lib/fields.ts` and `references.ts`, so a purpose-built screen imports those helpers instead of writing its own.
- `RecordScreen` edits the record's values (`CapabilityForm` with `initial`), clears an emptied optional field with `null`, confirms a retire in a dialog and returns to `list` afterwards. A row opens through `open`, else through `screens.resources` for the collection's resource kind.
- `CollectionScreen` has Export CSV: it reads the list query page by page under the current filters, search and sort and downloads the screen's columns. `RecordScreen` has Print, which prints the heading, the fields and the `sections` the application passes, without the forms or the shell. Mark other screen parts that should not print with the `print:hidden` variant.
- For gloved or high-frequency input, use the `operator` registry (`packages/operator-ui`) and read [point-of-work input](../../../../docs/point-of-work-input.md).
- `showcase/examples/winding-line/ui/station.tsx` composes a full station's screen.
- Each command a screen issues needs a matching `ui.binding` on its capability, its UI binding. The `add-capability` skill (`packages/runtime/skills/add-capability/SKILL.md`) covers it.
- The instance's content security policy rejects inline scripts and injected styles. Use components that render native elements, such as `ui/native-dialog`, instead of ones that inject styles at runtime.
- Browser files must not import server modules.

## Steps

1. Declare the routes in the application's `screens.tsx` with `defineScreens`: routes, navigation, the screen for each capability, and `resources` for screens that open a resource the OS delivers.
2. On a record screen that starts runs itself, call `useUiSession(resource, handlers)` from `@/lib/ui-session` with the record's `<kind>:<id>` and revision, so a run started from the screen captures it; with an `aside` that starts the runs, see step 13. List the kind in the application's `selectableResources`. The host confirms the revision against the read query's `revision` field and refuses a revision above 0 when the read has none; a generated collection item has none until it presents `ctx.getRevision` (`showcase/patterns/base/handlers.ts`).
   - A list screen with a checkbox on each row passes a list of `{ id, revision }` entries, one per selected row, with `id` as `<kind>:<id>` and the revision that row shows. The run captures every entry.
   - An `openResource` intent navigates through `screens.resources` unless the handlers pass `open`.
   - In the work component of a terminal, pass `open` so the intent shows the resource inside the component, since navigating ends the operator's session. `useUiSession`, `Accounts` and `RunPanel` call the host with the terminal's session, so a run started there acts as the terminal's principal; the operator's client from `useOperatorSession` still submits every command.
   - Pass `select` when the screen can change its selection without navigating; without it, `selectResource` is rejected.
   - A `prepare` intent fills a command's form for the person to submit. By default the prefill is held for `usePreparedInput(operation)`, which `CapabilityForm` reads, and the command's capability screen opens. A purpose-built form reads `usePreparedInput` itself, shows that an agent prepared it with a Discard, and calls `dismiss` once the person submits or discards. When that form is on a route of its own, pass `prepare`: it stores the prefill with `holdRunPrefill(id, operation, input)` from `@/lib/os-deliveries` and navigates there.
   - Render the returned `review` and call `acknowledgeReview` when the person has seen it. `showcase/patterns/agents/ui/methods.tsx` does both.
3. Give a station's screen `layout: 'full'`. Declare `compact` on a route for phone and portrait-tablet widths.
4. Declare a feature's screens with `defineFeatureScreens` from `@tortoise/frame/feature-screens`, and a plugin's with `definePluginScreens` in its `plugin-screens` entrypoint. Capability screen prefixes start with the unit's operation namespace and a dot.
5. Merge them with `defineScreens({ manifest, features, plugins })`, listed in the manifest's order. It fails on duplicate routes, on targets no route declares, and on unit screens that the manifest does not compose, are out of its order, or open capabilities outside the unit's namespace.
6. Write commands with `useCapabilityForm` from `@tortoise/react/form`. It keeps one idempotency key until the command commits, so a double tap or a scanner's double Enter records once. Do not create a key per click.
7. Read data with `useLiveQuery`. It refetches only the queries whose dependencies changed. Never filter or page client-side over a partial set.
8. Capture input with `useScannerInput`, `useCaptureTiming` and `useCaptureLoop` from `@tortoise/react/capture`, so capture time is measured. To put a scanned value into a `CapabilityForm` for the person to confirm, pass `fill` with a new `key` per scan; the other fields keep what the person typed, and nothing submits.
9. Change a registry item in its source. For the operator registry, edit `packages/operator-ui/registry.manifest.ts` and run `bun run build:registry:operator`.
10. Never hand-edit the generated `registry.json` or `src/styles/operator.css`.
11. Rebuild the frame registry with `bun run build:registry`.
12. For framework capabilities, wrap the registry screen in an application screen that passes the capabilities and a `describe` label, as `showcase/examples/receiving/ui/reconcile.tsx` does; `reconciliation-review` exports the `HeldEffect` type that `describe` takes. `approval-review` takes `approvalOperations`, and `reconciliation-review` takes `reconciliationOperations`.
    - `assignment-board`, `assignment-reports` and `my-assignments` take the operations that `defineAssignments` returns, one entry per kind, and optional slots per kind. The board takes the scope editor and a summary of what an assignment covers. The reports take the body view, the subject's name, the input that links a report and the reviewer's accept form. My assignments takes the brief view and the report form. Without a slot they show JSON and key fields generated from the kind's schemas. `worklist` takes the operations that `defineWorklist` returns, for an application that takes work from another, with the brief, report form, body and subject slots. `showcase/patterns/assignments/ui/rounds.tsx` and `showcase/patterns/worklist/ui/rounds.tsx` fill every slot.
13. For a panel beside every screen, declare `aside` in `defineScreens`. The shell docks it at the right and keeps it mounted across navigation; it sets its own width and decides how to show on a compact viewport. To open it there as a sheet, declare `asideButton` too. For an assistant, pass `AssistantPanel` and `AssistantButton` from `@/components/assistant-panel`, as `showcase/patterns/agents/screens.tsx` does. The panel lists the application's agents, starts a run per message through `POST /api/v1/runs` with the agent's ID and a conversation ID, and shows the conversation the host keeps, so a reload shows it again. Each record screen hands the record it shows to the panel with `useAssistantContext([{ ...resource, label }])` from `@/lib/assistant-context`; the panel's UI session selects it unless the person leaves it out. List the record's kind in `selectableResources`, and pass revision 0 for a read without a revision. A run's `ui.select` reaches the screen through `useAssistantSelect`. A panel of your own owns one UI session through `useUiSession` and reads runs with `useRuns`, as [agents](../../../../docs/agents.md#runs) describes. The aside narrows the screens: the shell's `main` is the size container `main`, so lay a screen out with `@<size>/main:` variants instead of viewport breakpoints.
14. Change the starter's look in `apps/web`. A file at the same `src/` path as a frame file replaces it. A replacement `app-shell` shows the build's best-before date only if it calls `useBuild` from `@/lib/build`.
15. Add stock primitives to `apps/web` with `shadcn add`. Keep domain screens in the application, never in the starter.
16. For native screens, use `defineNativeScreens` from `packages/frame-native` and follow the `extend-mobile-host` skill (`packages/mobile/skills/extend-mobile-host/SKILL.md`).

## Checks

1. Add a UI-binding test with `unboundOperations` from `@tortoise/testing/ui-bindings`, as in `showcase/examples/field-service/test/ui-bindings.test.ts`. It proves a screen references every capability that claims a binding.
2. Add feature and plugin screen directories to that test's scan.
3. Add a Playwright spec in `showcase/examples/<app>/e2e/` or `showcase/patterns/<app>/e2e/` that proves the screen renders and commits. The starter follows the operating system's color scheme, so `page.emulateMedia({ colorScheme: 'dark' })` shows a screen in dark.
4. Run the checks:

   ```sh
   bun run check:boundaries
   bun run build:web:examples
   bun run check:registry:operator
   bunx playwright test showcase/examples/<app>/e2e
   ```

5. Report browser runs separately from unit tests.

## References

- [`@tortoise/frame`](../../README.md)
- [`showcase/examples/field-service/screens.tsx`](../../../../showcase/examples/field-service/screens.tsx)
- [`showcase/examples/quality-inspection/ui/capture-station.tsx`](../../../../showcase/examples/quality-inspection/ui/capture-station.tsx)
- [Agents pattern](../../../../showcase/patterns/agents/README.md)
- [Interaction contract](../../../../docs/interaction-contract.md#ui-intents)
