---
name: build-screens
description: Build or change the web screens of an agent-native application, feature or host plugin. Use when adding a route, list or record screen, form, capture or workstation screen, navigation item or capability screen; when a screen shares its selection with agent runs or handles their UI intents; when pulling or changing an item of the agent-native or operator shadcn registry; or when replacing a frame file in the starter. Covers examples/<app>/screens.tsx, examples/<app>/ui, patterns/<name>/ui, packages/frame, packages/react, packages/operator-ui and apps/web.
---

# Build screens

[Screens](../../../../docs/glossary.md#screen) are the browser half of an application. They read through [live queries](../../../../docs/glossary.md#live-query) and write only through catalog commands.

## Before writing

- Start from a [UI registry](../../../../docs/glossary.md#ui-registry) item before writing a component. The items live in `packages/frame/src/components`:
  - `collection-screen` builds list and record screens from a collection's generated capabilities;
  - `collection-tree` shows a tree collection's generated `tree` read with search over its `list`;
  - `capability-form` renders any command;
  - `live-data-table` pages after the instance scopes rows.
- Declare [display metadata](../../../../docs/glossary.md#display-metadata) on the capability before writing columns or labels in a screen. `collection-screen`, `capability-form` and the command palette read it. A collection passes it as `titleField` and `fields`.
- For gloved or high-frequency input, use the `operator` registry (`packages/operator-ui`) and read [point-of-work input](../../../../docs/point-of-work-input.md).
- `examples/line-station/ui/station.tsx` composes a full station's screen.
- Each command a screen issues needs a matching `ui.binding` on its capability, its [UI binding](../../../../docs/glossary.md#ui-binding). The `add-capability` skill (`packages/runtime/skills/add-capability/SKILL.md`) covers it.
- The instance's content security policy rejects inline scripts and injected styles. Use components that render native elements, such as `ui/native-dialog`, instead of ones that inject styles at runtime.
- Browser files must not import server modules.

## Steps

1. Declare the routes in the application's `screens.tsx` with `defineScreens`: routes, navigation, the screen for each capability, and `resources` for screens that open a resource the OS delivers.
2. On a record screen, call `useUiSession(resource, handlers)` from `@/lib/ui-session` with the record's `<kind>:<id>` and revision, so a run started from the screen captures it. List the kind in the application's `selectableResources`.
   - An `openResource` intent navigates through `screens.resources` unless the handlers pass `open`.
   - Pass `select` when the screen can change its selection without navigating; without it, `selectResource` is rejected.
   - Render the returned `review` and call `acknowledgeReview` when the person has seen it. `patterns/agents/ui/methods.tsx` does both.
3. Give a station's screen `layout: 'full'`. Declare `compact` on a route for phone and portrait-tablet widths.
4. Declare a feature's screens with `defineFeatureScreens` from `@agent-native/frame/feature-screens`, and a plugin's with `definePluginScreens` in its `plugin-screens` entrypoint. Capability screen prefixes start with the unit's operation namespace and a dot.
5. Merge them with `defineScreens({ manifest, features, plugins })`, listed in the manifest's order. It fails on duplicate routes, on targets no route declares, and on unit screens that the manifest does not compose, are out of its order, or open capabilities outside the unit's namespace.
6. Write commands with `useCapabilityForm` from `@agent-native/react/form`. It keeps one [idempotency key](../../../../docs/glossary.md#idempotency-key) until the command commits, so a double tap or a scanner's double Enter records once. Do not mint keys per click.
7. Read data with `useLiveQuery`. It refetches only the queries whose dependencies changed. Never filter or page client-side over a partial set.
8. Capture input with `useScannerInput`, `useCaptureTiming` and `useCaptureLoop` from `@agent-native/react/capture`, so capture time is measured.
9. Change a registry item in its source. For the operator registry, edit `packages/operator-ui/registry.manifest.ts` and run `bun run build:registry:operator`.
10. Never hand-edit the generated `registry.json` or `src/styles/operator.css`.
11. Rebuild the frame registry with `bun run build:registry`.
12. For framework capabilities, wrap the registry screen in an application screen that passes the capabilities and a `describe` label, as `examples/receiving/ui/reconcile.tsx` does. `approval-review` takes `approvalOperations`, and `reconciliation-review` takes `reconciliationOperations`.
    - `assignment-board`, `assignment-reports` and `my-assignments` take the operations that `defineAssignments` returns, one entry per kind, and optional slots per kind. The board takes the scope editor and a summary of what an assignment covers. The reports take the body view, the subject's name, the input that places a report and the reviewer's accept form. My assignments takes the brief view and the report form. Without a slot they show JSON and key fields generated from the kind's schemas. `worklist` takes the operations that `defineWorklist` returns, for an application that takes work from another, with the brief, report form, body and subject slots. `patterns/assignments/ui/rounds.tsx` and `patterns/worklist/ui/rounds.tsx` fill every slot.
13. Change the starter's look in `apps/web`. A file at the same `src/` path as a frame file replaces it. A replacement `app-shell` shows the build's [best-before date](../../../../docs/glossary.md#best-before-date) only if it calls `useBuild` from `@/lib/build`.
14. Add stock primitives to `apps/web` with `shadcn add`. Keep domain screens in the application, never in the starter.
15. For native screens, use `defineNativeScreens` from `packages/frame-native` and follow the `extend-mobile-host` skill (`packages/mobile/skills/extend-mobile-host/SKILL.md`).

## Checks

1. Add a UI-binding test with `unboundOperations` from `@agent-native/testing/ui-bindings`, as in `examples/field-service/test/ui-bindings.test.ts`. It proves a screen references every capability that claims a binding.
2. Add feature and plugin screen directories to that test's scan.
3. Add a Playwright spec in `examples/<app>/e2e/` or `patterns/<app>/e2e/` that proves the screen renders and commits.
4. Run the checks:

   ```sh
   bun run check:boundaries
   bun run build:web:examples
   bun run check:registry:operator
   bunx playwright test examples/<app>/e2e
   ```

5. Report browser runs separately from unit tests.

## References

- [`@agent-native/frame`](../../README.md)
- [`examples/field-service/screens.tsx`](../../../../examples/field-service/screens.tsx)
- [`examples/quality-inspection/ui/capture-station.tsx`](../../../../examples/quality-inspection/ui/capture-station.tsx)
- [Agents pattern](../../../../patterns/agents/README.md)
- [Interaction contract](../../../../docs/interaction-contract.md#ui-intents)
