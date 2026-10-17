# @agent-native/project-tasks

A local project and task workspace: the smallest application that exercises the whole kernel. People and agents create projects, manage members with owner, editor and viewer roles, and create, edit and complete tasks. Owners see a private note on each task that no one else can read, search or sort by. It is the starter's default application in `app.config.json`, and the home of the framework's cross-cutting conformance suites.

Layer: content (`examples/*`). Domain code, screens, demo job and tests live here; nothing in `packages/*` or `apps/*` imports it.

## Primitives

This example is one [Application](../../docs/primitives.md#application). It composes:

- a [Module](../../docs/primitives.md#module) of twelve [capabilities](../../docs/primitives.md#capability) (`project.*`, `task.*`) and the six [Proposal](../../docs/primitives.md#proposal) operations; the plugins below add `compliance.*` and `webhook.*`;
- the `site`, `network`, `audit`, `compliance` and [`os`](../../plugins/os/README.md) [host plugins](../../docs/primitives.md#host-plugin), listed in its manifest and application entrypoints (and in its screens where the plugin has screens), and the example plugin [`webhook`](../../plugins/webhook/README.md) after them;
- [OS handlers](../../docs/primitives.md#os-handler) in `os.ts`: links `<scheme>://tasks/<id>` and `<scheme>://projects/<id>` open the project screen, and a `.txt` or `.md` file opened with the application prefills a new task from its name and text;
- a CASL [Policy](../../docs/primitives.md#policy) with row scopes (`taskReadScope`) and an owner-only protected field;
- [live queries](../../docs/primitives.md#journal-and-live-query) through the frame's session bindings in its screen, so changes from any caller appear without a refresh;
- the deterministic [Agent run](../../docs/primitives.md#agent-run) harness behind **Create tasks from brief**;
- the `project.planner` [Agent definition](../../docs/primitives.md#agent-definition), which proposes tasks and status changes about `project:<id>` or `task:<id>`. The **Proposals** screen (the frame's `proposal-review`) accepts them as the signed-in member, and the task rules then apply to that member.

The generated [operation reference](../../docs/reference/project-tasks/operations.md) lists every operation with its schema, permission and CLI form.

## Entrypoints

| Import                                    | Runs in            | Contents                                                                                                                                            |
| ----------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/project-tasks/manifest`    | browser and server | Default export: `defineManifest` with id `project-tasks` and its modules.                                                                           |
| `@agent-native/project-tasks/application` | server only        | Default export: `defineApplication` with state, upgrade, handlers, policy and selectable resources.                                                 |
| `@agent-native/project-tasks/screens`     | browser            | Default export: `defineScreens` with the Projects screen and the routes that open a project or task resource; the plugins add Security and Webhook. |
| `@agent-native/project-tasks/*`           | see file           | Other modules by name: `contracts` and `os` (browser-safe), `domain`, `policy`, `server`.                                                           |

`server` concatenates `handlers/projects` and `handlers/tasks`, which share the handler context, lookups, paging and DTOs in `server/context`. `ui/projects` re-exports the screens from `ui/projects/`: one file per component, with `useTaskDraft` in the task row and `useAction` and `useProjectSession` in the project screen. Drafts whose forms collapse (a new project name, a new task title) stay in the parent screen, so collapsing a form does not lose what was typed.

Run it on its own port and workspace with `bun run dev` (desktop) or `bun run dev:web` (browser) in this directory; port 4321. `bun run job` runs the demonstration job, which uses stable revision-bound idempotency keys and never opens the database.

## Trust boundary

The application definition is trusted code that runs inside the authority. Every operation authorizes against current state: roles come from project membership, never from input. Membership operations may name a target principal and role, but those inputs never change the caller's authority. Task reads are scoped before filtering, pagination and counts, `privateNote` is projected away for non-owners, and mutations take `expectedRevisions` so concurrent edits conflict instead of overwriting.

A link or file from the OS commits nothing. A task link opens only a task the session may read, because the host authorizes the resource before it queues the delivery. A file prefills title and description only; the project is the one the person has open, the prefilled task (`ui/projects/prepared-task.tsx`) shows where the values came from, and it is created only when the person adds it, with one idempotency key per prefill.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/frame`, `@agent-native/site`, `@agent-native/network`, `@agent-native/audit`, `@agent-native/compliance`, `@agent-native/os`, `@agent-native/webhook`, `@agent-native/client`, `@agent-native/adapters` and `@agent-native/testing` (tests). External: `zod`, `react`, `@tanstack/react-query`, `lucide-react`. Content must never import `apps/*`.

## Tests

```sh
bun test examples/project-tasks
bunx playwright test examples/project-tasks/e2e
```

| Test                                                                     | Proves                                                                                                                                    |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `domain.test.ts`                                                         | Role matrix, scoped counts and pages, protected fields.                                                                                   |
| `test/transport-conformance.test.ts`                                     | The same scenarios agree through direct, HTTP, CLI subprocess and MCP.                                                                    |
| `test/proposal-surfaces.test.ts`                                         | Accepting a proposal runs its command as the accepter, once, through direct, HTTP, CLI and MCP; a viewer's acceptance is refused on each. |
| `test/storage-conformance.test.ts`                                       | Memory and SQLite storage commit state, receipts and outbox identically.                                                                  |
| `test/security-conformance.test.ts`                                      | Grants constrain rows, replay and events; interruptions cannot commit or leak.                                                            |
| `test/hardening.test.ts`                                                 | Hardened sites admit only expiring launcher grants; mTLS still requires a session token.                                                  |
| `test/direct-transport.test.ts`                                          | The in-process transport resets after a revocation and never lifts launcher cancellation.                                                 |
| `test/host.test.ts`, `test/security.test.ts`, `test/ui-sessions.test.ts` | Host/Origin checks, launch credentials, sessions, delegated runs and UI-session scoping.                                                  |
| `test/application.test.ts`                                               | The host runs this definition end to end.                                                                                                 |
| `test/ui-bindings.test.ts`                                               | Every operation that claims a UI binding is referenced by a screen.                                                                       |
| `test/os.test.ts`                                                        | A task link opens its task; a Markdown file prefills `task.create` without committing, and adding it twice with one key adds one task.    |
| `e2e/workspace.pw.ts`                                                    | Chromium: agent writes appear without refresh, drafts survive conflicts, the deterministic harness works without a provider.              |
