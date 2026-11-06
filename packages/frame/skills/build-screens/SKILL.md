---
name: build-screens
description: Build web screens over application capabilities. Use for route and form changes, UI-session integration with agent runs, registry components, or starter frame overrides.
---

# Build screens

Build application screens over catalog operations. Reads use the typed live client, and changes use commands. [Channels and interaction](../../../../docs/interaction-contract.md) specifies display metadata and UI-session behavior.

## Screen declarations

Declare routes in the application's `screens.tsx` with `defineScreens`. Register navigation and capability bindings there. `resources` maps a resource kind to the route that opens it. Keep domain screens in the application workspace; a file in `apps/web/src` overrides the frame at the same path when the starter itself needs a change.

Use collection display metadata before writing custom field rendering. `collection-screen` and `collection-tree` consume the generated collection capabilities. `capability-form` renders a command. A custom screen can reuse field formatting and reference-title helpers from `packages/frame/src/lib/fields.ts` and `references.ts`.

Declare the list's supported filters and sorting in its capability. A partial client result cannot be filtered or paged as though it were the complete collection. `useLiveQuery` refreshes queries whose declared dependencies changed. `CollectionScreen` exports CSV through successive authorized pages under the active query inputs.

`RecordScreen` uses the current record as form input. An emptied optional field is submitted as `null`. Its print output includes the record fields and supplied sections; apply `print:hidden` to other content that should not print.

Give a workstation route `layout: 'full'`. Declare `compact` when the route supports narrow device widths. Use [operator input](../../../../docs/operator-input.md) for scanner and frequent keyboard interaction.

## Commands and forms

Every operation exposed by a screen needs its matching `ui.binding`. Keep a headless exception while a screen is still absent. Use `useCapabilityForm` from `@tortoise/react/form` so repeated submissions retain the same idempotency key until commit.

A scanned value can prefill `CapabilityForm` through `fill` with a fresh key per scan. This preserves other typed fields without submitting the form. Capture hooks are exported from `@tortoise/react/capture`. Scanner keyboard bursts must be intercepted before they submit an unrelated form; follow [add-scanner-input](../../../devices/skills/add-scanner-input/SKILL.md).

Browser files must not import server modules. The instance's CSP rejects inline scripts and runtime-injected styles. Choose components compatible with that policy, including `ui/native-dialog` for dialogs.

## UI sessions

A screen that starts a run calls `useUiSession(resource, handlers)` from `@/lib/ui-session`. Register the selected `<kind>:<id>` and the revision returned by its read query. Add the resource kind to the application's `selectableResources`. A read without a revision can register revision 0; expose `ctx.getRevision` through the read handler when the run needs optimistic concurrency.

A list selection supplies `{ id, revision }` for each selected resource. The run captures the checked selection when it starts. A later selection change does not retarget that run.

`openResource` normally navigates through `screens.resources`. Supply `open` when the resource must be shown inside the current component. A terminal work component needs that behavior because leaving `/terminal` ends its operator session. Host calls made by `useUiSession`, `Accounts` and `RunPanel` use the terminal's session. Domain commands in the work component must use the client supplied by `useOperatorSession`.

Supply `select` when the screen can apply a selection intent. A prepared command form uses `usePreparedInput(operation)`, which `CapabilityForm` reads. A custom form must show its prepared origin and offer Discard, then call `dismiss` after submission or discard. If the form has a separate route, supply `prepare` and call `holdRunPrefill(id, operation, input)` from `@/lib/os-deliveries` before navigation.

Render a returned review and call `acknowledgeReview` after the person has seen it. Intent handling changes UI state; the command submitted by the person still performs normal validation and authorization.

## Assistant panels

Declare `aside` in `defineScreens` for a panel that remains mounted across route changes. `asideButton` supplies its compact-viewport entry point. The frame provides `AssistantPanel` and `AssistantButton` from `@/components/assistant-panel`.

Each record screen can publish its displayed resources with `useAssistantContext([{ ...resource, label }])` from `@/lib/assistant-context`. The panel selects them in its own UI session unless the person excludes them. `useAssistantSelect` applies a run's selection intent to the screen. A custom panel must own the UI session whose ID and context version it submits when creating a run; see [Agents](../../../../docs/agents.md#runs).

The frame's panel starts a run for each message using the agent ID and conversation ID. It reads the retained host conversation after reload. Its width reduces the screen's available space. The shell's `main` is a size container named `main`; use `@<size>/main:` variants for layouts affected by the aside.

## Features and registry components

Feature screens use `defineFeatureScreens` from `@tortoise/frame/feature-screens`. Plugins use `definePluginScreens` in their browser entrypoint. Compose them through `defineScreens({ manifest, features, plugins })` in manifest order. Capability screen prefixes belong to the contributing unit's operation namespace.

Approval and reconciliation screens wrap the corresponding registry component and pass its operation set. `reconciliation-review` exports the `HeldEffect` type for its `describe` callback. Assignment registry screens take the operations returned by `defineAssignments`; their slots provide application-specific forms and resource presentation. The worklist registry consumes `defineWorklist`. Consult [assign-work](../../../assignments/skills/assign-work/SKILL.md) for those bindings.

Edit registry source files before regenerating output. Operator items are declared in `packages/operator-ui/registry.manifest.ts`; rebuild with `bun run build:registry:operator`. Do not hand-edit generated `registry.json` or `src/styles/operator.css`. Rebuild frame items with `bun run build:registry`. Stock primitives can be added to `apps/web` with `shadcn add`.

A replacement application shell must call `useBuild` from `@/lib/build` if it displays build metadata. Native screens follow [extend-mobile-host](../../../mobile/skills/extend-mobile-host/SKILL.md).

## Checks

Use `unboundOperations` from `@tortoise/testing/ui-bindings` to check claimed bindings. Include the directories of composed feature and plugin screens in its scan. The declaration check does not establish that submitting the form performs the right command; add a browser test for that behavior and an appropriate refusal case.

```sh
bun run check:boundaries
bun run build:web:examples
bun run check:registry:operator
bunx playwright test showcase/examples/<app>/e2e
```

Use `page.emulateMedia({ colorScheme: 'dark' })` for dark-mode verification. Record the browser run separately from unit-test results. The [frame README](../../README.md) identifies implementation entrypoints.
