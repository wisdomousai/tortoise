# @agent-native/service

The starter's [instance](../../docs/glossary.md#instance) process: the HTTP entry and the application CLI for the application that `app.config.json` names. It is the one place the [starter](../../docs/glossary.md#starter) learns which content it hosts, and it learns it from configuration. Adding or switching an application therefore changes no starter code.

## Layer

Starter (`apps/*`), owned by whoever forks or scaffolds the starter. It trusts the application it is configured with, which runs with the [host](../../docs/glossary.md#host)'s privileges. Everything it runs comes from [`@agent-native/host`](../../packages/host/README.md).

## Primitives

- [Starter](../../docs/primitives.md#starter): `configuredApplication`, `runService`.

## Entrypoints

This package exports nothing; it is run.

| File | Run with | Holds |
| --- | --- | --- |
| [`src/index.ts`](src/index.ts) | `bun run dev:web` | `runService`, which serves the configured application over HTTP; `apps/desktop` starts it as a sidecar. |
| [`src/cli.ts`](src/cli.ts) | `bun run cli …` | The application's catalog-derived CLI, named after the starter. |
| [`src/application.ts`](src/application.ts) | imported by both | `starterConfig` and `configuredApplication`, which read `app.config.json` and load the application at runtime. |

The CLI has `serve`, `mcp`, `drain` and `sync`, the plugins' verbs such as `site` and `audit`, and every [capability](../../docs/glossary.md#capability).

Environment:

- `WORKSPACE_PATH`, default `.workspace`;
- `PORT`, default `4317`, where `0` picks one;
- `WEB_ROOT`, default `dist/web/<application id>`;
- `AGENT_RUNTIME_MANIFEST`;
- every setting the application's plugins declare, read by `readPluginSettings`, such as `AGENT_NATIVE_SITE_POLICY` with the site plugin and `AGENT_NATIVE_AUDIT_LOG` with the audit plugin;
- `AGENT_NATIVE_APPLICATION`, which overrides the configured application for one launch.

`bun run build:cli` compiles the same CLI into `dist/bin/<name>` with a generated static application entry, because a binary cannot follow a runtime import.

## Trust boundary

[Callers](../../docs/glossary.md#caller) are untrusted, and the host authenticates them. The instance prints a single-use, short-lived `launchUrl` and writes a [connection file](../../docs/glossary.md#connection-file). Both are local credentials. Without a [deployment policy](../../docs/glossary.md#deployment-policy), the instance is isolated to loopback.

The starter names no [host plugin](../../docs/glossary.md#host-plugin); the application composes them. `runService` passes the application's URL scheme from `app.config.json` as the default of `AGENT_NATIVE_OS_SCHEME`. Only the OS plugin reads it, and the launcher's environment wins.

## Dependencies

Framework: `@agent-native/host` only. The package must never import `examples/*`. `bun run check:boundaries` fails a static import from content by path or package name.

## Tests

```sh
bun run test:service
bun run test:sandbox
```

The package is a few lines of wiring and has no test files; its behavior is the host's. An example's `test/application.test.ts` drives the host with that application. `test:sandbox` compiles the standalone CLI binary and runs it with an empty environment.

## Skills

- [create-agent-native-app](../../packages/scaffold/skills/create-agent-native-app/SKILL.md): starting an application on the starter.
