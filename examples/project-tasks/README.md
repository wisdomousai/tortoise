# @agent-native/project-tasks

A local project and task workspace: the smallest application that exercises the whole kernel. People and agents create projects, manage members with owner, editor and viewer roles, and create, edit and complete tasks. Owners see a private note on each task that no one else can read, search or sort by. It is the starter's default application in `app.config.json`, and the home of the framework's cross-cutting conformance suites.

Layer: content (`examples/*`). Domain code, screens, demo job and tests live here; nothing in `packages/*` or `apps/*` imports it.

## Primitives

This example is one [Application](../../docs/primitives.md#application). It composes:

- a [Module](../../docs/primitives.md#module) of fourteen [capabilities](../../docs/primitives.md#capability) (`project.*`, `task.*` and `task-reminders.effect.settle`) and the six [Proposal](../../docs/primitives.md#proposal) operations; the plugins below add `compliance.*` and `webhook.*`;
- the `site`, `network`, `audit`, `compliance` [`os`](../../plugins/os/README.md) and [`share-target`](../../plugins/share-target/README.md) and [`notifications`](../../plugins/notifications/README.md) and [`os-shortcuts`](../../plugins/os-shortcuts/README.md) [host plugins](../../docs/primitives.md#host-plugin), listed in its manifest and application entrypoints (and in its screens where the plugin has screens), and the example plugin [`webhook`](../../plugins/webhook/README.md) after them;
- [OS handlers](../../docs/primitives.md#os-handler) in `os.ts`: links `<scheme>://tasks/<id>` and `<scheme>://projects/<id>` open the project screen, a `.txt` or `.md` file opened with the application prefills a new task from its name and text, and a PNG, JPEG or PDF prefills one with the file attached; text or a link shared from another app prefills a task's description, and a shared image or PDF prefills its title and attachment; the launcher entry New task (`task.new`: the dock menu, the Windows jump list, an Android app shortcut, the installed web app's shortcuts) opens an empty new task;
- an [OS action](../../docs/primitives.md#os-action) `task.reminder`. `task.remind` queues an [outbox effect](../../docs/primitives.md#outbox-effect) to `task-reminders`, which the notifications plugin shows on the desktop or phone. Its Mark done reply (`task.reminder-reply`) runs `task.set-status` to done. `task-reminders.effect.settle` records on the task whether it was shown;
- the [Blob store](../../docs/primitives.md#blob-store): `task.create` attaches an optional file within `attachmentLimits` (`attachments.ts`), `task.delete` drops the reference, and the task row links to the bytes;
- a CASL [Policy](../../docs/primitives.md#policy) with row scopes (`taskReadScope`) and an owner-only protected field;
- [live queries](../../docs/primitives.md#journal-and-live-query) through the frame's session bindings in its screen, so changes from any caller appear without a refresh;
- the deterministic [Agent run](../../docs/primitives.md#agent-run) harness behind **Create tasks from brief**;
- the `project.planner` [Agent definition](../../docs/primitives.md#agent-definition), which proposes tasks and status changes about `project:<id>` or `task:<id>`. The **Proposals** screen (the frame's `proposal-review`) accepts them as the signed-in member, and the task rules then apply to that member.

`bun run generate` writes the operation reference, with every operation's schema, permission and CLI form, to `dist/reference/project-tasks/operations.md`.

## Entrypoints

| Import                                    | Runs in            | Contents                                                                                                                                            |
| ----------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/project-tasks/manifest`    | browser and server | Default export: `defineManifest` with id `project-tasks` and its modules.                                                                           |
| `@agent-native/project-tasks/application` | server only        | Default export: `defineApplication` with state, upgrade, handlers, policy and selectable resources.                                                 |
| `@agent-native/project-tasks/screens`     | browser            | Default export: `defineScreens` with the Projects screen and the routes that open a project or task resource; the plugins add Security and Webhook. |
| `@agent-native/project-tasks/*`           | see file           | Other modules by name: `contracts`, `os` and `attachments` (browser-safe), `domain`, `policy`, `server`.                                            |

`server` concatenates `handlers/projects` and `handlers/tasks`, which share the handler context, lookups, paging and DTOs in `server/context`. `ui/projects` re-exports the screens from `ui/projects/`: one file per component, with `useTaskDraft` in the task row and `useAction` and `useProjectSession` in the project screen. Drafts whose forms collapse (a new project name, a new task title) stay in the parent screen, so collapsing a form does not lose what was typed.

Run it on its own port and workspace with `bun run dev` (desktop) or `bun run dev:web` (browser) in this directory; port 4321. `bun run job` runs the demonstration job, which uses stable revision-bound idempotency keys and never opens the database.

## Trust boundary

The application definition is trusted code that runs inside the authority. Every operation authorizes against current state: roles come from project membership, never from input. Membership operations may name a target principal and role, but those inputs never change the caller's authority. Task reads are scoped before filtering, pagination and counts, `privateNote` is projected away for non-owners, and mutations take `expectedRevisions` so concurrent edits conflict instead of overwriting.

A link or file from the OS commits nothing. A task link opens only a task the session may read, because the host authorizes the resource before it queues the delivery. A file or a share prefills title and description, or title and attachment, only; the project is the one the person has open, the prefilled task (`ui/projects/prepared-task.tsx`) shows where the values came from, and it is created only when the person adds it, with one idempotency key per prefill. An attached file is uploaded before the request is submitted and stays staged, readable by nobody, until the person adds the task; the runtime lets only the uploading principal attach it, within `attachmentLimits`, and a prefill that is discarded leaves it for the blob store to sweep.

A reminder notifies the person who asked for it, and only their reply counts. Mark done runs `task.set-status` as them when they choose it, so a person who lost edit access since the reminder cannot use it. A reminder asked for in the browser waits until the desktop or phone app runs, because a web page shows no notifications. Only the notification dispatcher, the owner acting under its delegated grant, may call `task-reminders.effect.settle`.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/frame`, `@agent-native/site`, `@agent-native/network`, `@agent-native/audit`, `@agent-native/compliance`, `@agent-native/os`, `@agent-native/share-target`, `@agent-native/webhook`, `@agent-native/client`, `@agent-native/adapters` and `@agent-native/testing` (tests). External: `zod`, `react`, `@tanstack/react-query`, `lucide-react`. Content must never import `apps/*`.

## Tests

```sh
bun test examples/project-tasks
bunx playwright test examples/project-tasks/e2e
```

| Test                                                                     | Proves                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain.test.ts`                                                         | Role matrix, scoped counts and pages, protected fields.                                                                                                                                                                                                                                                                                                                                                                                              |
| `test/transport-conformance.test.ts`                                     | The same scenarios agree through direct, HTTP, CLI subprocess and MCP.                                                                                                                                                                                                                                                                                                                                                                               |
| `test/proposal-surfaces.test.ts`                                         | Accepting a proposal runs its command as the accepter, once, through direct, HTTP, CLI and MCP; a viewer's acceptance is refused on each.                                                                                                                                                                                                                                                                                                            |
| `test/storage-conformance.test.ts`                                       | Memory and SQLite storage commit state, receipts and outbox identically.                                                                                                                                                                                                                                                                                                                                                                             |
| `test/security-conformance.test.ts`                                      | Grants constrain rows, replay and events; interruptions cannot commit or leak.                                                                                                                                                                                                                                                                                                                                                                       |
| `test/hardening.test.ts`                                                 | Hardened sites admit only expiring launcher grants; mTLS still requires a session token.                                                                                                                                                                                                                                                                                                                                                             |
| `test/direct-transport.test.ts`                                          | The in-process transport resets after a revocation and never lifts launcher cancellation.                                                                                                                                                                                                                                                                                                                                                            |
| `test/host.test.ts`, `test/security.test.ts`, `test/ui-sessions.test.ts` | Host/Origin checks, launch credentials, sessions, delegated runs and UI-session scoping.                                                                                                                                                                                                                                                                                                                                                             |
| `test/application.test.ts`                                               | The host runs this definition end to end.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `test/ui-bindings.test.ts`                                               | Every operation that claims a UI binding is referenced by a screen.                                                                                                                                                                                                                                                                                                                                                                                  |
| `test/os.test.ts`                                                        | A task link opens its task; a Markdown file prefills `task.create` without committing, and adding it twice with one key adds one task; an uploaded image prefills a task, stays unreadable until added, and a forged reference is refused. A link posted to the web share target is held and prefills a task for the session that claims it. A reminder waits for the desktop relay, shows with Mark done, and its reply sets the task to done once. |
| `e2e/workspace.pw.ts`                                                    | Chromium: agent writes appear without refresh, drafts survive conflicts, the deterministic harness works without a provider.                                                                                                                                                                                                                                                                                                                         |

## Demonstrated mechanisms

Example paths are relative to `examples/project-tasks`. Framework paths start at the checkout root.

| Mechanism | Code | Proof |
| --- | --- | --- |
| [Capability](../../docs/primitives.md#capability) and [module](../../docs/primitives.md#module) declarations | `contracts.ts`: `operations`, `projectTasksModule` | `test/ui-bindings.test.ts`; `test/transport-conformance.test.ts` |
| [Application](../../docs/primitives.md#application) composed from one state slice | `application.ts`: `createProjectTasksApplication` | `test/application.test.ts` |
| Unversioned state upgrade instead of a [state migration](../../docs/primitives.md#state-migration) | `application.ts`: `upgradeState` | `test/application.test.ts` |
| [Policy](../../docs/primitives.md#policy) with CASL row scopes and an owner-only field | `policy.ts`: `projectTaskPolicy`, `taskReadScope` | `domain.test.ts`: "scopes rows before page/count/search…" |
| Roles held per project | `policy.ts`: `projectRole`; `handlers/projects.ts` | `domain.test.ts`: "object and field restrictions protect current and proposed state" |
| Revisions, idempotency keys and conflicts | `server/context.ts`: `dto`; `ui/projects/task-row.tsx`: `useTaskDraft` | `domain.test.ts`: "conflicts, duplicate retries, revocation…"; `e2e/workspace.pw.ts` |
| Delegated grants limited to resources | `grant` on each rule in `policy.ts`; list handlers | `test/security-conformance.test.ts`: "resource grants constrain rows…" |
| Output projection on read and on replay | `policy.ts`: `projectOutput` | `test/security-conformance.test.ts`, same test |
| [Surface adapters](../../docs/primitives.md#surface-adapter) for direct calls, HTTP, the CLI and MCP | Generated from the catalog; no example code | `test/transport-conformance.test.ts` |
| Memory and SQLite [storage](../../docs/primitives.md#storage) | No example code; the host or the test supplies the adapter | `test/storage-conformance.test.ts` |
| [Journal and live query](../../docs/primitives.md#journal-and-live-query) | `dependencies` in `contracts.ts`; `live.liveQueryOptions` in `ui/` | `test/direct-transport.test.ts`; `test/host.test.ts`: "SSE resets after revocation…" and "HTTP projections agree across sessions…"; `e2e/workspace.pw.ts` |
| [Proposal](../../docs/primitives.md#proposal) operations and review screen | `handlers/proposals.ts`; `proposalRules` in `policy.ts`; `ui/proposals.tsx` | `test/proposal-surfaces.test.ts` |
| [Agent definition](../../docs/primitives.md#agent-definition) that proposes | `contracts.ts`: `project.planner` | No test in this example |
| [Agent run](../../docs/primitives.md#agent-run) with [UI session context](../../docs/primitives.md#ui-session-context) | `ui/projects/agent-panel.tsx`; `selectableResources` in `application.ts` | `test/host.test.ts`: "real host preserves delegated authority…"; `test/ui-sessions.test.ts`; `e2e/workspace.pw.ts` |
| [Blob store](../../docs/primitives.md#blob-store) references with limits | `attachments.ts`; `handlers/tasks.ts` | `test/os.test.ts`: "an image is staged…" |
| [Outbox effect](../../docs/primitives.md#outbox-effect) and its settle command | `task.remind`, `task-reminders.effect.settle` in `handlers/tasks.ts` | `test/os.test.ts`: "a reminder waits for the desktop…" |
| [Dispatcher](../../docs/primitives.md#dispatcher) for the reminder target | `plugins/notifications/src/open.ts`: `createEffectDispatcher`, one per notify target | `test/os.test.ts`: "a reminder waits for the desktop…" |
| [OS handlers](../../docs/primitives.md#os-handler) and an [OS action](../../docs/primitives.md#os-action) | `os.ts`: `projectTasksOs` | `test/os.test.ts`; `e2e/os.pw.ts` |
| [Shell port](../../docs/primitives.md#shell-port) for OS requests and instructions | `plugins/os`; the host's `shell/actions` and `shell/requests` routes | `test/os.test.ts`: "a reminder waits for the desktop…" |
| [Audit log](../../docs/primitives.md#event-log) written by the runtime | The audit plugin in `application.ts` | `test/security.test.ts`: "the host attests, audits each channel…" and "startup resolves a command accepted before a crash" |
| [Site policy](../../docs/primitives.md#site-policy) and hardening floors, with [workforce sign-in](../../docs/primitives.md#workforce-sign-in) | The site plugin in `application.ts` | `test/security.test.ts`: "an unusable site policy refuses startup…"; `test/hardening.test.ts`: "an external identity floor needs a workforce provider…" |
| [Egress guard](../../docs/primitives.md#egress-guard) | The network plugin in `application.ts` | `test/security.test.ts`: "provider egress is denied unless the site policy binds it" |
| [Host plugin](../../docs/primitives.md#host-plugin) composition, with a third-party plugin | Plugin lists in `manifest.ts`, `application.ts`, `screens.tsx` | `e2e/workspace.pw.ts`, which counts the plugins' MCP tools; `test/ui-bindings.test.ts` |
| Exclusive workspace ownership through the [host platform](../../docs/primitives.md#host-platform) | `packages/host/src/platform/bun.ts`: `bunPlatform`; no example code | `packages/adapters/src/ownership.test.ts`; `test/security.test.ts`: "…refuses startup and releases the workspace" for release after a refused start |
| [Workspace lease](../../docs/primitives.md#workspace-lease) on the hosted platform | No example code; `serve --hosted-workspace` | No test here; one by-hand run in the [implementation status](../../docs/implementation-status.md#hosted-authority) |
| [Capability binding](../../docs/primitives.md#capability-binding) coverage | `screens.tsx` and `ui/` | `test/ui-bindings.test.ts` |
| Background job as an ordinary caller | `job.ts` | No test and no recorded run |
| Host session, origin and launch checks, with this example as fixture | Framework code in `packages/adapters` and `packages/host` | `test/host.test.ts` |

## Structure

| Path | Holds |
| --- | --- |
| `manifest.ts` | Browser-safe identity: id, title, the module and the plugin manifests in order. |
| `application.ts` | Application definition: state slice, upgrade, handlers, authorization route, selectable resources, plugins. |
| `screens.tsx` | Routes, navigation, capability screens, resource paths, the project sidebar and plugin screens. |
| `contracts.ts` | The fourteen capabilities, the proposal operations, one workflow, the planner agent and the module's OS declarations. |
| `domain.ts` | State types and the empty slice, with tombstones for deleted tasks. |
| `policy.ts` | Project roles, the CASL ability, command, query and event rules, output projection. |
| `server.ts`, `server/context.ts` | The handler list, lookups, paging and the revision-carrying result shape. |
| `handlers/` | Projects and membership, tasks and reminders, proposals. |
| `os.ts`, `attachments.ts` | OS declarations and the blob limits a task's file must meet. |
| `job.ts` | The demonstration job, which calls the host over HTTP. |
| `ui/projects.tsx`, `ui/proposals.tsx` | The screens the routes name: projects, one project, proposals and the open-proposal count. |
| `ui/projects/` | One file per screen part: sidebar, project screen, task row, prefilled task, agent panel. |
| `domain.test.ts`, `test/`, `e2e/` | Policy, conformance, host and OS tests; Playwright specs. |

## Task edit flow

Renaming a task from its row passes through these steps.

1. Editing starts in `ui/projects/task-row.tsx` with a fresh read of the task. The draft keeps that revision as its base while the live list updates around it.
2. Saving sends the new title through the typed client, with the base revision as the expected revision of `task:<id>`. The HTTP client adds a random idempotency key when the caller gives none.
3. The host derives the principal, workspace and grant from the session. Fields in the request body cannot set them, as `test/host.test.ts` shows.
4. The runtime validates the input against the strict schema in `contracts.ts`. A field the schema does not list, such as a new project, fails with `INVALID_INPUT`.
5. The composed authorization routes the command to the example's policy with the project-tasks slice. A grant that lists resources must name `task:<id>`.
6. The task rule then resolves the project from stored state and looks up the caller's role there. Its allow check asks the CASL ability whether the caller may edit the task and each field in the input.
7. The runtime compares the expected revision with the stored one and fails with `CONFLICT` when they differ. The task row shows its conflict banner earlier, once the live task moves past the draft's base.
8. The handler in `handlers/tasks.ts` applies the patch and declares the task as changed. It returns the task with its next revision.
9. The policy's output projection removes the private note for callers who are not project owners. The policy then decides the command again on the state before and after the change.
10. Inside the same transaction, the runtime stores state, revision, receipt and journal entry, and appends an accepted record to the audit log. The record holds a digest of the whole input and its field names; this example allow-lists no field values.
11. Live queries that declare the task resource type refetch for every caller who may see the event. A retry with the same key returns the stored receipt, projected under current access.

## Task reminder flow

A reminder is an outbox effect that the notifications plugin delivers to the desktop window or phone. The person's reply arrives as a separate shell request.

1. The bell on a task row calls `task.remind`. The policy allows owners and editors of an active project.
2. The handler enqueues an effect to the `task-reminders` target. Its notification payload names the caller, the category, the task title and one reply that sets the task to done.
3. The handler records which task the effect is about and sets the task's reminder to pending. The effect commits with the command or not at all.
4. The notifications plugin's dispatcher claims the effect as the owner under a narrow delegated grant. While no desktop window or phone is attached for the notified person, the effect stays pending.
5. The Electron main process polls the host for OS instructions with the connection-file session, which the window shares. It receives a notify instruction with a Mark done button that carries a single-use code.
6. After the relay, the dispatcher calls `task-reminders.effect.settle` with the outcome. The handler settles the effect and copies the outcome onto the task.
7. Choosing Mark done sends a reply request to the host's shell port. The notifications plugin redeems the code once and continues with `task.set-status` as the replying person.
8. A second report of the same choice changes nothing. The task's revision stays the same, as the reminder test in `test/os.test.ts` checks.

## Implementation steps

The steps start from `scaffold new`. The scaffold's add commands edit only files with its insertion markers, and an export of this example has none.

1. Create the application with a project record type, following the [create-agent-native-app skill](../../packages/scaffold/skills/create-agent-native-app/SKILL.md). Run this from the framework checkout.

   ```sh
   bun run scaffold new /absolute/path/to/my-app --name my-app --display-name "My App" --collection project
   ```

2. Install the pinned dependencies. Run this in the new directory.

   ```sh
   bun install --frozen-lockfile
   ```

3. Add the task record type with the scaffold, which writes its contract, handlers, policy rules, screens, test, state entry, event rule and navigation. Run this in the new directory.

   ```sh
   bun run scaffold add collection task
   ```

4. Add each further capability with the scaffold, which writes its contract, handler, policy rule and test. Run it once per capability in the new directory, as below for the reminder, and again for `task.delete` and `task.set-status`; the [add-capability skill](../../packages/runtime/skills/add-capability/SKILL.md) covers the rest by hand.

   ```sh
   bun run scaffold add capability task.remind --kind command --description "Remind yourself of a task"
   ```

5. Add the planner agent with the scaffold, as the [setup reference](../../packages/scaffold/skills/create-agent-native-app/references/new-application.md) describes. Run this in the new directory.

   ```sh
   bun run scaffold add agent planner --collection task
   ```

   The command writes these parts.
   - **Agent definition:** `contracts/planner-agent.ts`, which lists and reads tasks and proposes `task.update`, with the propose output mode.
   - **Proposal operations:** added to the contracts by the first agent only, with `handlers/proposals.ts` built on `proposalHandlers`.
   - **Proposal rules and state:** a proposal entry in the state, a rule for each proposal command and query with accept and reject limited to a person, and a proposal event rule.
   - **Proposals screen:** `ui/proposals.tsx`, with its route and navigation entry.
   - **Agent scenario test:** `test/planner-agent.test.ts`, which plays scenarios with `runAgentScenarios`.

6. Format and regenerate after the add commands, and again after any later one. Run this in the new directory.

   ```sh
   bun run format
   bun run generate
   ```

7. Edit the files the scaffold wrote for the new domain. They already hold keyed records, ID and clock services, and the application definition.
   - **Record schemas:** `contracts/<type>.ts`, one file per record type, capability and agent; `contracts.ts` only spreads them.
   - **Handlers:** `handlers/<type>.ts`, one file per part, and `handlers/context.ts`.
   - **Default screens:** `ui/<type>.tsx`, one file per record type, and `ui/proposals.tsx`.
   - **Composition:** `domain.ts`, `policy.ts`, `server.ts`, `application.ts`, `manifest.ts` and `screens.tsx`.
8. Link tasks to projects in `contracts/task.ts`: add `projectId` to the task schema, the create input and the list's `filters`. Set it in the create handler.
9. Replace the workspace `members` map in `domain.ts` with a member map on each project, and store the workspace owner's ID in the state. Then change `policy.ts` as follows.
   - Remove the `caller` gate and the `editor` rule.
   - Pass `definePolicy` a `roleOf` option that returns the caller's role in a container, as `projectRole` does in the example.
   - Give every rule a `container` and `roles`, including the generated proposal rules. The runtime consults the option only for a rule with a container, and an open rule admits any principal once the gate is gone.
10. Keep a tombstone that maps each deleted record to its container, as `deletedTasks` does. Replays and event checks resolve the container from it.
11. Shape each contract with `defineCapability`. A generated capability starts with empty input and output, the application as resource type and a headless UI exception; give it these parts.
    - **ID:** stable and dotted, such as `task.remind`.
    - **Schemas:** strict input and output schemas through `jsonSchema`.
    - **Permission:** the action and resource type the policy decides.
    - **Dependencies:** the resource types whose changes make live queries refetch.
    - **UI:** a binding to a screen, or a stated exception for a headless capability.
12. Write records through the `records` helper that the generated handlers use; it declares each change and throws `NOT_FOUND` for a missing record. Call `ctx.change` only for a resource the helper does not write.
13. Replace the generated event rules, which show every event to every member, with rules that resolve each record's project. Add an output projection for owner-only fields, as [authorization](../../docs/authorization.md) describes.
14. Build row and field rules with `createScopedAbility` from `@agent-native/adapters/casl`.
15. Replace the generated `visible` predicate in each generated list and read handler with a check through `matchesScope` and the grant's resources. The list handler applies it before filtering, paging and counting, and the generated policy already marks the lists as open.
16. Model roles in a container with the framework's [membership](../../docs/primitives.md#membership) primitive. This example writes `project.set-member` by hand instead.
    - **Contract:** `defineMembership` from the contracts package.
    - **Handler:** `membershipHandler(membership, store)` from the runtime package, where `store.members` returns a container's role map.
    - **Policy rule:** `membershipRule` from the runtime package.
17. Declare any other change to access by passing the `authorization.changed` event type to `ctx.change`. Open screens then drop protected data in the same commit.
18. To let the module compose next to others, wrap the handlers with `sliceHandlers` and route the policy through `composeAuthorization` with one `authorizationRoute`.
19. Set `blobs` limits on the capability that accepts a file. Type its input field with `blobRefSchema`.
20. Reference the bytes with `ctx.attach` in the create handler.
21. Drop the reference with `ctx.detach` in the delete handler.
22. Declare OS handlers and actions as an `OsDeclarations` object on the module. The [add-os-integration skill](../../packages/shell/skills/add-os-integration/SKILL.md) maps each kind to its plugin.
23. Append the plugins that serve the declared kinds to the lists in `application.ts` and `manifest.ts`, with `osPlugin` before `notificationsPlugin`, which requires it. The kernel's `checkPlugins` refuses lists that differ in plugins or order, or that place a plugin before one it requires.
24. Set `integration: { target, delivery: 'outbox' }` on the capability that sends a notification. A target that a queueing notify action carries needs no network destination.
25. Enqueue the notification with `ctx.enqueue`, passing `target`, `type`, `resource` and an `OsNotificationPayload` as `payload`. The payload holds the principal, the category, a title, an optional body and optional replies, as the [notifications plugin README](../../plugins/notifications/README.md) lists.
26. Declare a notify OS action whose `targets` list the outbox target and whose offline mode is `queue`. Give it `dataClasses` for the payload's fields and a category whose buttons name a reply handler.
27. Declare that reply handler with `consumer: 'notifications'`.
28. Add a settle command named `<target>.effect.settle` whose input holds `effectId`, an `outcome` typed with `effectOutcomeSchema` and an optional `fence`. Its handler passes all three to `ctx.settleEffect`, and the catalog refuses a notify target without this command, per the [notifications plugin README](../../plugins/notifications/README.md).
29. Allow the settle command only to the stored owner ID under a delegated grant, which is how the notifications dispatcher calls it.
30. Keep the notifications plugin as the reminder target's connector. This example uses no fake system; `createNotificationPort` in that plugin delivers its effects.
31. For effects that must reach a system of record, add a target with `bun run scaffold add target <name> --collection <type>`. Replace its generated fake with a connector that implements `SystemOfRecordPort`, as the [connect-system-of-record skill](../../packages/integration/skills/connect-system-of-record/SKILL.md) describes.
32. Extend the screens in `screens.tsx`, following the [build-screens skill](../../packages/frame/skills/build-screens/SKILL.md). List routes, navigation, capability screens, resource paths and plugin screens.
33. Replace the generated default screens in `ui/`, which use `CollectionScreen` and `RecordScreen`, with purpose-built screens where the domain needs them.
34. Read data in those screens with `useQuery(live.liveQueryOptions(…))`, taking `live` from `@/lib/session`.
35. Write with `useCapabilityForm`, or with the typed client and expected revisions as the task row does.
36. Show OS prefills with `usePreparedInput` from `@/lib/os-deliveries` and `OsProvenanceNotice` from `@/components/os-provenance`.
37. Share the open record with agent runs through `useUiSession` from `@/lib/ui-session`.
38. Name the query that validates each selectable record in `selectableResources`.
39. Write a background job as an HTTP caller with `createHttpTransport` from `@agent-native/client`, as `job.ts` does. Read the connection file with `readConnection`.
40. Bind each of the job's idempotency keys to the record's revision, and send that revision as the expected one.
41. Adapt the tests the scaffold wrote to the new domain: `test/conformance.test.ts`, `test/ui-bindings.test.ts`, `test/project.test.ts`, `e2e/default-screens.pw.ts` and one test per add command. The [Tests](#tests) section says what each of this example's test files proves.

    | Test file in this example | Helpers |
    | --- | --- |
    | `domain.test.ts` | `createApplication`, `createMemoryStorage` |
    | `test/storage-conformance.test.ts` | `directDriver`, `assertEquivalent` |
    | `test/transport-conformance.test.ts` | `startHost`, `createMcpServer` |
    | `test/ui-bindings.test.ts` | `unboundOperations` |
    | `e2e/*.pw.ts` | Playwright; `startService` in `tests/e2e/service.ts` |

42. Extend the generated agent scenario test with the planner's own scenarios, as the [agent harnesses guide](../../docs/agent-harnesses.md) describes.
43. Run these checks before calling the work done, and report the evidence as the [check-a-change skill](../../packages/testing/skills/check-a-change/SKILL.md) says. Run this in the new directory.

    ```sh
    bun run check:format
    bun run check:boundaries
    bun run check:manifests
    bun run check:framework
    bun run check:size
    bun run check:registry:operator
    bun run generate
    bun run typecheck
    bun test examples/my-app
    bun run test:portable
    bun run build
    bunx playwright test examples/my-app/e2e
    ```

    Leave out `bun run check` and the full `bun test` in an application exported from source. The README and skill checks fail on links to examples and package scripts the export leaves out, and one compliance test fails on evidence the export does not carry.

## Limits

- **Planner agent.** No test runs the `project.planner` definition, and the agent panel starts runs by harness and prompt only. Proposals from this agent are unproven; the proposal test covers proposals a viewer submits.
- **State migrations.** Without numbered migrations the workspace has no state version. The upgrade step must accept every older shape on each load, and the staged `migrate` command has no step to apply.
- **Membership.** The handler fixes only the workspace owner's entry, so a project owner can remove or demote another project owner. The commit-phase check refuses a change to the caller's own owner role.
- **People directory.** The access form takes a principal ID as free text. The owner must know the ID; nothing lists the people who could be added.
- **Deletes.** A deleted task has no restore command. The blob store sweeps its file after the grace period.
- **Reminders in the browser.** A web page shows no notifications. A reminder requested there stays pending until a desktop window or phone runs for the same person.
- **Real OS.** No link, file, share, shortcut or notification has gone through a real operating system, per the [implementation status](../../docs/implementation-status.md#os-integration). Staged uploads are lost when the host restarts.
- **Demonstration job.** The job has no automated test. It needs `AGENT_NATIVE_CONNECTION` set to a running host's connection file.
- **Full check.** In an application that `scaffold new` exported from source, `bun run check` fails at its README and skill checks, and one compliance test fails in the full `bun test`. The [recorded scaffold runs](../../docs/implementation-status.md#layers-and-scaffold) pass the whole check only for an application that installs the framework from a registry.
- **Systems of record.** The example has no target besides reminders, no inbound sync and no remote query.

## Related pages

- [Capability authoring](../../docs/capability-authoring.md)
- [Authorization](../../docs/authorization.md)
- [State and reactivity](../../docs/state-and-reactivity.md)
- [Agent harnesses](../../docs/agent-harnesses.md)
- [Notifications plugin README](../../plugins/notifications/README.md)
- [create-agent-native-app skill](../../packages/scaffold/skills/create-agent-native-app/SKILL.md)
- [add-capability skill](../../packages/runtime/skills/add-capability/SKILL.md)
- [build-screens skill](../../packages/frame/skills/build-screens/SKILL.md)
- [add-os-integration skill](../../packages/shell/skills/add-os-integration/SKILL.md)
- [connect-system-of-record skill](../../packages/integration/skills/connect-system-of-record/SKILL.md)
- [check-a-change skill](../../packages/testing/skills/check-a-change/SKILL.md)
- [Quality inspection](../quality-inspection/README.md)
- [CRM capture](../crm-capture/README.md)
- [Receiving](../receiving/README.md)
