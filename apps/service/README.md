# @agent-native/service

The starter's authority process: the service entry and the application CLI for whatever application `app.config.json` names. It is the one place the starter learns which content it hosts, and it learns it from configuration, so adding or switching an application changes no starter code. Everything it runs comes from [`@agent-native/host`](../../packages/host/README.md).

Layer: starter (`apps/*`). Owned by whoever forks or scaffolds the starter.

## Primitives

- [Starter](../../docs/primitives.md#starter): `configuredApplication`, `runService`.

## Entrypoints

This workspace exports nothing; it is run.

| File                                       | Run with          | Purpose                                                                                                                                                                      |
| ------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/index.ts`](src/index.ts)             | `bun run dev:web` | `runService`: serve the configured application over HTTP. The desktop shell starts it as a sidecar.                                                                          |
| [`src/cli.ts`](src/cli.ts)                 | `bun run cli …`   | The application's catalog-derived CLI, named after the starter (`serve`, `mcp`, `drain`, `sync`, the plugins' commands such as `security` and `audit`, and every operation). |
| [`src/application.ts`](src/application.ts) | imported by both  | `starterConfig`, `configuredApplication`: read `app.config.json` and load the application at runtime.                                                                        |

Environment: `WORKSPACE_PATH` (default `.workspace`), `PORT` (default `4317`, `0` picks one), `WEB_ROOT` (default `dist/web/<application id>`), `AGENT_RUNTIME_MANIFEST`, every setting the application's plugins declare (`readPluginSettings`; with the site plugin `AGENT_NATIVE_SITE_POLICY`, with the audit plugin `AGENT_NATIVE_AUDIT_LOG`), and `AGENT_NATIVE_APPLICATION` to override the configured application for one launch. `bun run build:cli` compiles the same CLI into `dist/bin/<name>` with a generated static application entry, because a binary cannot follow a runtime import.

## Trust boundary

The starter trusts the application it is configured with; it runs with the host's privileges. Callers are untrusted and are authenticated by the host. The service prints a single-use, short-lived `launchUrl` and writes a connection file, both of which are local credentials. Without a site policy the service is isolated: loopback only. The starter names no plugin; the application composes them.

## Dependencies

Framework: `@agent-native/host` only. It must never import `examples/*`; `bun run check:boundaries` fails a static import from content by path or package name.

## Tests

```sh
bun run test:service
bun run test:sandbox
```

The service is a few lines of wiring; its behavior is the host's. Each example's `test/application.test.ts` drives the host with that application, and `test:sandbox` compiles and runs the standalone CLI binary with an empty environment.
