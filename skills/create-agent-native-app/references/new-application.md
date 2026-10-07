# New application

Locate the source checkout by its root `package.json` and `packages/scaffold/src/index.ts`; do not assume a machine-specific path. From that checkout run:

```sh
bun run scaffold /absolute/path/to/absent-target --name my-application --display-name "My Application"
```

The command copies allowlisted source packages, app entrypoints, tests, scripts, documentation, the lockfile and skills. Framework packages remain local workspaces. It excludes dependency directories, build output, workspace data, credentials and symlinks, and refuses any existing target. `scaffold.manifest.json` records the framework version and SHA-256 of exported files. The export does not initialize Git or install dependencies. `app.config.json` owns the application name, display name and desktop app ID; the export sets these from the supplied name. Browser builds and desktop packaging consume that identity. Set a production app ID before distributing the application.

In the new checkout install the pinned dependencies with `bun install --frozen-lockfile`, then run `bun run typecheck`, `bun run generate`, `bun test`, and `bun run build`. Run the documented browser/desktop checks when those products are part of the request. A cold dependency cache needs network access; an offline install failure is a dependency-fetch limitation, not an application check passing.

Use the project/task example to establish the working end-to-end baseline, then author the requested domain. Change domain contracts/handlers/policy/UI/workflows together. Keep the generic framework packages free of domain-specific imports. Do not present the example as the finished requested application.

For an application over existing systems of record, use the [task/workflow pattern](../../../docs/task-workflow-pattern.md) to define one bounded interaction: trigger, input/evidence, record authority, allowed outcomes and exception owner. Fit the UI to its input conditions while humans and agents share semantic capabilities. Start screens from the kit in `apps/web/src/components` (`capability-form` for a first pass, `capture-station` as the pattern for high-frequency entry) and keep `useCapabilityForm` so retries reuse one idempotency key. Record capture timing so the time saved can be measured rather than assumed. Keep model inference optional for deterministic input paths.

Treat an upstream API as a connector to another authority, separately from local storage. A local receipt cannot prove remote acceptance. Implement a `SystemOfRecordPort` for the target and follow `examples/quality-inspection`: enqueue effects in commands, settle outcomes through a domain command under a narrowly granted integration principal, and pull master data with watermark-bound sync commands. The framework does not reconcile uncertain outcomes; design and test that path if the target can accept a write whose reply is lost and cannot deduplicate by effect ID; make those states queryable through the same catalog and visible in the UI. Do not perform external writes inside a local transaction or let a CLI bypass application policy with broad upstream credentials.

For agents in a sandbox, ship `bun run build:cli` output: `mcp --embedded --grant-file` serves them in-process under an orchestrator-written grant, and `drain` must exit 0 before the sandbox is discarded. Choose an actual isolation backend if the requested app runs arbitrary tool code. Current harness profiles are not an OS sandbox, and source export is not a signed update/fleet system. Use the [reference plan](../../../docs/system-of-record-reference-plan.md) for the missing implementation gates; report those gaps separately from scaffolding success.
