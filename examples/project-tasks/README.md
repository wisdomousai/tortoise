# @agent-native/project-tasks

A local project and task workspace: the smallest application that exercises the whole kernel. People and agents create projects, manage members with owner, editor and viewer roles, and create, edit and complete tasks. Owners see a private note on each task that no one else can read, search or sort by. It is the starter's default application in `app.config.json`, and the home of the framework's cross-cutting conformance suites.

Layer: content (`examples/*`). Domain code, screens, demo job and tests live here; nothing in `packages/*` or `apps/*` imports it.

## Primitives

This example is one [Application](../../docs/primitives.md#application). It composes:

- a [Module](../../docs/primitives.md#module) of twelve [capabilities](../../docs/primitives.md#capability) (`project.*`, `task.*`); the plugins below add `compliance.*` and `webhook.*`;
- the `site`, `network`, `audit` and `compliance` [host plugins](../../docs/primitives.md#host-plugin), listed in each of its three entrypoints, and the example plugin [`webhook`](../../plugins/webhook/README.md) after them;
- a CASL [Policy](../../docs/primitives.md#policy) with row scopes (`taskReadScope`) and an owner-only protected field;
- [live queries](../../docs/primitives.md#journal-and-live-query) through the frame's session bindings in its screen, so changes from any caller appear without a refresh;
- the deterministic [Agent run](../../docs/primitives.md#agent-run) harness behind **Create tasks from brief**.

The generated [operation reference](../../docs/reference/project-tasks/operations.md) lists every operation with its schema, permission and CLI form.

## Entrypoints

| Import                                    | Runs in            | Contents                                                                                            |
| ----------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| `@agent-native/project-tasks/manifest`    | browser and server | Default export: `defineManifest` with id `project-tasks` and its modules.                           |
| `@agent-native/project-tasks/application` | server only        | Default export: `defineApplication` with state, upgrade, handlers, policy and selectable resources. |
| `@agent-native/project-tasks/screens`     | browser            | Default export: `defineScreens` with the Projects screen; the plugins add Security and Webhook.     |
| `@agent-native/project-tasks/*`           | see file           | Other modules by name: `contracts` (browser-safe), `domain`, `policy`, `server`.                    |

`server` concatenates `handlers/projects` and `handlers/tasks`, which share the handler context, lookups, paging and DTOs in `server/context`. `ui/projects` re-exports the screens from `ui/projects/`: one file per component, with `useTaskDraft` in the task row and `useAction` and `useProjectSession` in the project screen. Drafts whose forms collapse (a new project name, a new task title) stay in the parent screen, so collapsing a form does not lose what was typed.

Run it on its own port and workspace with `bun run dev` (desktop) or `bun run dev:web` (browser) in this directory; port 4321. `bun run job` runs the demonstration job, which uses stable revision-bound idempotency keys and never opens the database.

## Trust boundary

The application definition is trusted code that runs inside the authority. Every operation authorizes against current state: roles come from project membership, never from input. Membership operations may name a target principal and role, but those inputs never change the caller's authority. Task reads are scoped before filtering, pagination and counts, `privateNote` is projected away for non-owners, and mutations take `expectedRevisions` so concurrent edits conflict instead of overwriting.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/frame`, `@agent-native/site`, `@agent-native/network`, `@agent-native/audit`, `@agent-native/compliance`, `@agent-native/webhook`, `@agent-native/client`, `@agent-native/adapters` and `@agent-native/testing` (tests). External: `zod`, `react`, `@tanstack/react-query`, `lucide-react`. Content must never import `apps/*` ([P11](../../docs/principles.md#p11--framework-starter-and-content-are-separate-layers-and-an-authority-runs-one-application)).

## Tests

```sh
bun test examples/project-tasks
bunx playwright test examples/project-tasks/e2e
```

| Test                                                                     | Proves                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain.test.ts`                                                         | Role matrix, scoped counts and pages, protected fields.                                                                                                                                                                                                          |
| `test/transport-conformance.test.ts`                                     | The same scenarios agree through direct, HTTP, CLI subprocess and MCP ([P1](../../docs/principles.md#p1--every-operation-is-executable-from-ui-mcp-cli-and-api)).                                                                                                |
| `test/storage-conformance.test.ts`                                       | Memory and SQLite storage commit state, receipts and outbox identically ([P4](../../docs/principles.md#p4--every-write-is-a-command-to-the-single-authority-of-its-workspace), [P9](../../docs/principles.md#p9--every-external-dependency-sits-behind-a-port)). |
| `test/security-conformance.test.ts`                                      | Grants constrain rows, replay and events; interruptions cannot commit or leak ([P3](../../docs/principles.md#p3--authority-comes-from-trusted-context-never-from-input-and-is-enforced-at-commit)).                                                              |
| `test/hardening.test.ts`                                                 | Hardened sites admit only expiring launcher grants; mTLS still requires a session token.                                                                                                                                                                         |
| `test/direct-transport.test.ts`                                          | The in-process transport resets after a revocation and never lifts launcher cancellation ([P5](../../docs/principles.md#p5--every-committed-change-reaches-every-authorized-view-whatever-its-origin)).                                                          |
| `test/host.test.ts`, `test/security.test.ts`, `test/ui-sessions.test.ts` | Host/Origin checks, launch credentials, sessions, delegated runs and UI-session scoping.                                                                                                                                                                         |
| `test/application.test.ts`                                               | The host runs this definition end to end.                                                                                                                                                                                                                        |
| `test/ui-bindings.test.ts`                                               | Every operation that claims a UI binding is referenced by a screen.                                                                                                                                                                                              |
| `e2e/workspace.pw.ts`                                                    | Chromium: agent writes appear without refresh, drafts survive conflicts, the deterministic harness works without a provider.                                                                                                                                     |
