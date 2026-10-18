# @agent-native/project-tasks

`project-tasks` is a local project and task workspace, and the smallest application that exercises the whole [kernel](../../docs/glossary.md#kernel). People and agents create projects, manage members with owner, editor and viewer roles, and create, edit and complete tasks. Owners see a private note on each task that no one else can read, search or sort by.

It is the starter's default application in `app.config.json`, and the home of the framework's cross-cutting conformance suites. It demonstrates [state and reactivity](../../docs/state-and-reactivity.md), [authorization](../../docs/authorization.md), [agents](../../docs/agents.md) and [capability authoring](../../docs/capability-authoring.md).

## Layer

Content (`examples/*`). Domain code, screens, the demonstration job and tests live here. Nothing in `packages/*` or `apps/*` imports it.

## Primitives

The example is one [application](../../docs/primitives.md#application). It composes:

- a [module](../../docs/primitives.md#module) of fourteen [capabilities](../../docs/primitives.md#capability) (`project.*`, `task.*` and `task-reminders.effect.settle`) and the six [proposal](../../docs/primitives.md#proposal) capabilities. The plugins add `compliance.*` and `webhook.*`.
- the `site`, `network`, `audit`, `compliance`, [`os`](../../plugins/os/README.md), [`share-target`](../../plugins/share-target/README.md), [`notifications`](../../plugins/notifications/README.md) and [`os-shortcuts`](../../plugins/os-shortcuts/README.md) [host plugins](../../docs/primitives.md#host-plugin). The manifest and the application list them, and the screens list those that have screens. The example plugin [`webhook`](../../plugins/webhook/README.md) comes after them.
- [OS handlers](../../docs/primitives.md#os-handler) in `os.ts`, listed under [OS requests](#os-requests).
- an [OS action](../../docs/primitives.md#os-action), `task.reminder`. `task.remind` queues an [outbox effect](../../docs/primitives.md#outbox-effect) to `task-reminders`, which the notifications plugin shows on the desktop or phone. Its Mark done reply (`task.reminder-reply`) runs `task.set-status` to done. `task-reminders.effect.settle` records on the task whether the reminder was shown.
- the [blob store](../../docs/primitives.md#blob-store). `task.create` attaches an optional file within `attachmentLimits` (`attachments.ts`), `task.delete` drops the reference, and the task row links to the bytes.
- a CASL [policy](../../docs/primitives.md#policy) with row scopes (`taskReadScope`) and an owner-only protected field.
- [live queries](../../docs/primitives.md#journal-and-live-query) through the frame's session bindings in its screen, so changes from any caller appear without a refresh.
- the deterministic [agent run](../../docs/primitives.md#agent-run) harness behind **Create tasks from brief**.
- the `project.planner` [agent definition](../../docs/primitives.md#agent-definition), which proposes tasks and status changes about `project:<id>` or `task:<id>`. The **Proposals** screen (the frame's `proposal-review`) accepts them as the signed-in member, and the task rules then apply to that member.

`bun run generate` writes the capability reference to `dist/reference/project-tasks/operations.md`, with every capability's schema, permission and CLI form.

### OS requests

- Links `<scheme>://tasks/<id>` and `<scheme>://projects/<id>` open the project screen.
- A `.txt` or `.md` file opened with the application prefills a new task from its name and text.
- A PNG, JPEG or PDF file prefills a new task with the file attached.
- Text or a link shared from another application prefills a task's description.
- A shared image or PDF prefills a task's title and attachment.
- The launcher entry New task (`task.new`) opens an empty new task. It appears in the dock menu, the Windows jump list, an Android shortcut and the installed web application's shortcuts.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/project-tasks/manifest` | browser and server | Default export: `defineManifest` with ID `project-tasks` and its modules. |
| `@agent-native/project-tasks/application` | server only | Default export: `defineApplication` with state, upgrade, handlers, policy and selectable resources. |
| `@agent-native/project-tasks/screens` | browser | Default export: `defineScreens` with the Projects screen and the routes that open a project or task. |
| `@agent-native/project-tasks/*` | see file | `contracts`, `os` and `attachments` (browser-safe), `domain`, `policy`, `server`. |

The plugins add the Security and Webhook screens.

`server` concatenates `handlers/projects` and `handlers/tasks`, which share the handler context, lookups, paging and DTOs in `server/context`.

`ui/projects` re-exports the screens from `ui/projects/`, one file per component. The task row uses `useTaskDraft`, and the project screen uses `useAction` and `useProjectSession`. Drafts whose forms collapse, such as a new project name or a new task title, stay in the parent screen. Collapsing a form therefore does not lose what was typed.

### Commands

| Command (in this directory) | Purpose |
| --- | --- |
| `bun run dev` | Desktop window on port 4321, with its own workspace. |
| `bun run dev:web` | Browser on port 4321, with its own workspace. |
| `bun run job` | The demonstration job. |

The job uses stable revision-bound [idempotency keys](../../docs/glossary.md#idempotency-key) and never opens the database.

## Trust boundary

The [application definition](../../docs/glossary.md#application-definition) is trusted code that runs inside the [authority](../../docs/glossary.md#authority).

- Every capability authorizes against current state. Roles come from project membership and never from input.
- Membership capabilities may name a target principal and role. Those inputs never change the caller's authority.
- Task reads are scoped before filtering, pagination and counts.
- `privateNote` is projected away for non-owners.
- Mutations take `expectedRevisions`, so concurrent edits conflict instead of overwriting.

A link or file from the OS commits nothing. A task link opens only a task the session may read, because the host authorizes the resource before it queues the delivery. A file or a share prefills only the title and description, or the title and attachment. The project is the one the person has open.

The prefilled task (`ui/projects/prepared-task.tsx`) shows where the values came from. It is created only when the person adds it, with one idempotency key per prefill.

An attached file is uploaded before the request is submitted. It stays staged, readable by nobody, until the person adds the task. The runtime lets only the uploading principal attach it, within `attachmentLimits`. When a prefill is discarded, the blob store sweeps the file.

A reminder notifies the person who asked for it, and only their reply counts. Mark done runs `task.set-status` as them at the moment they choose it. A person who lost edit access since the reminder therefore cannot use it. A reminder asked for in the browser waits until the desktop or phone application runs, because a web page shows no notifications. Only the notification [dispatcher](../../docs/glossary.md#dispatcher) may call `task-reminders.effect.settle`, as the owner under its [delegated grant](../../docs/glossary.md#grant).

## Dependencies

Framework and plugins: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/frame`, `@agent-native/client`, `@agent-native/adapters`, `@agent-native/site`, `@agent-native/network`, `@agent-native/audit`, `@agent-native/compliance`, `@agent-native/os`, `@agent-native/share-target`, `@agent-native/notifications`, `@agent-native/os-shortcuts` and `@agent-native/webhook`. The tests also use `@agent-native/testing`, `@agent-native/agents` and `@agent-native/event-log`.

External: `zod`, `react`, `@tanstack/react-query`, `@tanstack/react-router` and `lucide-react`. Content must never import `apps/*`.

## Tests

```sh
bun test examples/project-tasks
bunx playwright test examples/project-tasks/e2e
```

- `domain.test.ts`: the role matrix, scoped counts and pages, and protected fields.
- `test/transport-conformance.test.ts`: the same scenarios agree directly, over HTTP, through a CLI subprocess and over MCP.
- `test/proposal-surfaces.test.ts`: accepting a proposal runs its command once as the accepter, directly, over HTTP, the CLI and MCP. A viewer's acceptance is refused on each.
- `test/storage-conformance.test.ts`: memory and SQLite storage commit state, receipts and outbox identically.
- `test/security-conformance.test.ts`: grants constrain rows, replay and events, and interruptions cannot commit or leak.
- `test/hardening.test.ts`: hardened sites admit only expiring launcher grants, and mTLS still requires a session token.
- `test/direct-transport.test.ts`: the in-process transport resets after a revocation and never lifts launcher cancellation.
- `test/host.test.ts`, `test/security.test.ts` and `test/ui-sessions.test.ts`: Host and Origin checks, launch credentials, sessions, delegated runs and UI-session scoping.
- `test/application.test.ts`: the host runs this definition end to end.
- `test/ui-bindings.test.ts`: every capability that claims a UI binding is referenced by a screen.
- `test/os.test.ts`:
  - a task link opens its task;
  - a Markdown file prefills `task.create` without committing, and adding it twice with one key adds one task;
  - an uploaded image prefills a task and stays unreadable until added, and a forged reference is refused;
  - a link posted to the web share target is held and prefills a task for the session that claims it;
  - a reminder waits for the desktop relay, shows with Mark done, and its reply sets the task to done once.
- `e2e/workspace.pw.ts`, in Chromium: agent writes appear without a refresh, drafts survive conflicts, and the deterministic harness works without a provider.
- `e2e/os.pw.ts`, in Chromium: a protocol-handler landing opens the task, files and shares prefill tasks the person adds, a reminder waits, and a shortcut starts a task.

## Skills

- [add-capability](../../packages/runtime/skills/add-capability/SKILL.md) covers the capabilities, the policy and the scenarios.
- [build-screens](../../packages/frame/skills/build-screens/SKILL.md) covers the screens and the UI-binding test.
- [add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md) covers the OS handlers, the reminder and the OS plugins.
- [write-host-plugin](../../packages/host/skills/write-host-plugin/SKILL.md) covers the `webhook` example plugin.
