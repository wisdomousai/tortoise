# Architecture

An application is a set of commands and queries plus screens. The host runs one application on one workspace, and every caller (screen, agent, script) goes through it.

```text
screen ─┐
CLI ────┼─► host ─► runtime: validate, authorize, run handler ─► storage (one transaction)
MCP ────┤                                                          │
HTTP ───┘                                                          ├─► journal ─► live screens refresh
                                                                   └─► outbox ─► dispatcher ─► ERP / MES
```

## Layers

| Folder                                   | What goes there                                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/*`                             | The framework. Names no domain.                                                                                                   |
| `workstations/*`                         | Screen bridge and workstation sign-in. Import the framework only. |
| `plugins/*`                              | [Host plugins](#host-plugins): network, audit, deployment policy, compliance and more.                                                  |
| `apps/*`                                 | The starter: service, web, desktop and mobile wrappers. Runs the app named in `app.config.json`.           |
| `showcase/examples/*`, `showcase/patterns/*` | Applications. Yours goes here too.                                                                                            |
| `sdks/*`                                 | [Driver](hardware-drivers.md) SDKs for Python and C#.                                                                             |

A file in `apps/web/src` replaces the frame file at the same path.

## Application entrypoints

Every application has three files the starter loads:

| File             | Holds                                                                    | Runs in       |
| ---------------- | ------------------------------------------------------------------------ | ------------- |
| `manifest.ts`    | ID, title, modules (contracts), features, plugins. Browser-safe.         | browser, host |
| `application.ts` | `defineApplication`: state, handlers, policy, plugins, integrations.     | host          |
| `screens.tsx`    | `defineScreens`: routes and navigation.                                  | browser       |

A generated `application.ts`:

```ts
export function createInspectionDeskApplication(options: InspectionDeskOptions = {}) {
  const state = (ownerId: string) => createState(ownerId, options.members);
  return defineApplication<AppState, Services>({
    manifest,
    createState: state,
    upgradeState: (stored, ownerId) => upgradeState(stored, state(ownerId)),
    handlers: createHandlers(),
    authorization: appPolicy,
    plugins: [deploymentPlugin, networkPlugin, auditPlugin, compliancePlugin],
    connect: () => ({ integrations: [] }),
  });
}
```

`bun run generate` writes the app's reference (OpenAPI, operations, agent skill) to `dist/reference/<id>/`. Don't commit it.

## Surfaces and identity

All surfaces call the same handlers with the same checks. The caller's identity comes from the session, never from input.

| Surface      | How to call it                                              | Who you are                                                         |
| ------------ | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| HTTP         | `POST /api/v1/commands/<id>`, `/api/v1/queries/<id>`        | Browser: launch link, then a cookie. Process: bearer token.         |
| Live updates | `GET /api/v1/events` (SSE)                                  | Same session; read access filters the stream.                       |
| MCP          | `bun run mcp`; `task.create` becomes tool `task_create`     | Connection file, or a grant file with `bun run cli mcp --embedded`. |
| CLI          | `bun run cli <collection> <verb>`                           | Same as MCP.                                                        |
| React        | `useLiveQuery`, `useCommand` from `@tortoise/react`     | Browser session.                                                    |

## Instances and hosts

An instance is the application opened on one workspace. Only one process writes a workspace.

| Host platform | Storage            | Lock                           | Can open sockets and processes |
| ------------- | ------------------ | ------------------------------ | ------------------------------ |
| Bun           | SQLite             | OS lock on `.workspace/`       | yes                            |
| Hosted        | Postgres           | Workspace lease | yes            |
| Mobile        | SQLite snapshot    | exclusive transaction          | no                             |

Startup order (`packages/kernel/src/instance.ts`): check requirements, open plugins, open storage and blobs, run plugin `ready` hooks, start dispatchers and inbound sync. On failure everything closes, newest first.

### Embedded and attached modes

- **Attached:** the CLI or MCP bridge talks to a running host through `.workspace/.connection.json`. The desktop window attaches the same way.
- **Embedded:** `bun run cli mcp --embedded [--grant-file f]` or `bun run cli <collection> <verb> --embedded` opens the workspace itself. If a host is already running, it gets `CONFLICT`.

## Storage

Storage gives handlers one atomic transaction per command. State must be plain JSON.

| Adapter                                        | Used by            |
| ---------------------------------------------- | ------------------ |
| Memory                                         | tests              |
| `SQLiteStorage` (one row per record)           | Bun host           |
| `PostgresStorage` (same rows; hosts share them) | hosted instance   |
| `SnapshotStorage` (one JSON document)          | mobile             |

A new adapter must pass the storage conformance suite in `packages/testing`.

## Host plugins

A host plugin adds a cross-cutting concern. It provides ports; without it, the safe default applies.

| Port      | Default                     | Plugin                              |
| --------- | --------------------------- | ----------------------------------- |
| Network   | refuse every destination    | `plugins/network` (egress guard) |
| Ingress   | loopback only               | `plugins/network` (TLS, mTLS)       |
| Identity  | trust the local owner       | `plugins/deployment`                      |
| Audit log | none                        | `plugins/audit`                     |
| Shell     | no OS integration           | `plugins/os`                        |
| Processes | refuse every child process  | `plugins/process`                   |
| Folders   | none                        | `plugins/deployment`                      |

To use a plugin, list it in both `manifest.ts` (`deploymentPluginManifest`) and `application.ts` (`deploymentPlugin`), in the same order. To write one, follow [write-host-plugin](../packages/host/skills/write-host-plugin/SKILL.md).

### Features and host plugins

A feature is a reusable domain part, such as approval requests. Mount it with `mountFeature` and give it an access view computed from your roles. A plugin is like a feature but provides ports instead of reading your roles.

Composition fails at startup if:

- the manifest's feature or plugin list differs from `application.ts`, or a plugin comes before one it requires;
- two units share an ID or an operation namespace, or an operation is outside its unit's namespace;
- two plugins provide the same port, or a needed port has no provider;
- the settings include one that no plugin declares.

### Lifecycle

| Hook    | When                                                               |
| ------- | ------------------------------------------------------------------ |
| `open`  | before storage; may refuse startup                                 |
| `ready` | in every instance, before the first request                        |
| `start` | in a serving host after it listens; never in embedded CLI or MCP   |
| `close` | on shutdown, in reverse order                                      |

Tests: `packages/host/test/plugins.test.ts`.

### Telemetry

`plugins/telemetry` turns the audit log and outbox into OpenTelemetry metrics and spans, so handlers contain no metrics code. It exports IDs, states, error codes, counts and durations, never record contents or principals. See the [telemetry plugin](../plugins/telemetry/README.md).

## Rules the checks enforce

`bun run check` tests these:

- One handler per capability; screens, HTTP, MCP and CLI get the same results and errors.
- Authorization runs inside the transaction. The policy filters rows before counting or paging.
- A command commits state, revisions, receipt, journal and outbox in one transaction, or nothing.
- Handlers make no network or model calls. Changes to other systems go through the outbox.
- Server code reaches the network only through the network port and starts processes only through the process port. `scripts/boundary-rules.ts` lists the exemptions.
- The framework imports no plugin, workstation, starter or example.

## Examples

| Example                                                            | Shows                                                             |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| [field-service](../showcase/examples/field-service/README.md)      | Work orders, roles, live updates, OS integration. The default app. |
| [quality-inspection](../showcase/examples/quality-inspection/README.md) | Outbox to a fake quality system, instrument driver.          |
| [winding-line](../showcase/examples/winding-line/README.md)        | A workstation app driven through its screen, scanner, MES sync.   |
| [crm-capture](../showcase/examples/crm-capture/README.md)          | Live reads of a fake CRM with each caller's own access.           |
| [asset-survey](../showcase/examples/asset-survey/README.md)        | Assignments for paired phones, photo extraction, a fake EAM.      |
| [asset-survey-field](../showcase/examples/asset-survey-field/README.md) | The phone side of asset-survey on the [mobile host](mobile.md). |
| [receiving](../showcase/examples/receiving/README.md)              | Goods receipts to an ERP through files. A scaffold export.  |
| [fleet](../showcase/examples/fleet/README.md)                      | The [fleet](hosting.md#fleet) server that instances report to.        |
| [parts-desk](../showcase/examples/parts-desk/README.md)            | The spare parts desk from the [tutorial](tutorials/index.md): quotes and an assistant panel on a local model. |
| [tool-store](../showcase/examples/tool-store/README.md)            | The plant tool store from the [tutorial](tutorials/index.md): loans, a counter terminal, an EAM, agents, a deployment policy. |

Stack: Bun, TypeScript, Zod, SQLite or Postgres, CASL, React, Vite, TanStack Query, shadcn, Tailwind, Electron, Expo, Playwright.
