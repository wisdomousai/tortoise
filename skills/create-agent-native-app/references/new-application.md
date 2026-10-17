# New application

Locate the source checkout by its root `package.json` and `packages/scaffold/src/index.ts`; do not assume a machine-specific path. From that checkout run:

```sh
bun run scaffold new /absolute/path/to/absent-target --name my-application --display-name "My Application" --collection <record-type>
```

The command copies allowlisted source packages, the starter, tests, scripts, documentation, the lockfile and skills, leaves every example out, and generates the application in `examples/<name>`: `manifest.ts`, `application.ts` and `screens.tsx`, contracts, domain, policy and handlers, one collection with default list and record screens, the site, network, audit and compliance plugins, a cross-surface conformance test, a UI-binding test and a Playwright spec of the default screens. The root manifest, the lockfile and `app.config.json` name it as the hosted application. Framework packages are copied as local workspaces because they are not published yet. It excludes dependency directories, build output, workspace data, credentials and symlinks, and refuses any existing target. `scaffold.manifest.json` records the framework version and SHA-256 of exported files. The export does not initialize Git or install dependencies. Set a production app ID in `app.config.json` before distributing the application.

In the new checkout install the pinned dependencies with `bun install --frozen-lockfile`. Then grow the application with generated parts, each with its contract, handlers, policy rule, screens where it has any and a behavioral test:

```sh
bun run scaffold add collection <record-type>
bun run scaffold add capability <dotted.operation-id> --kind command|query --description "<what it does, for whom>"
bun run scaffold add target <system-name> --collection <record-type>
bun run format && bun run generate
```

`add` inserts at the `// scaffold:<list>` markers in the generated files; keep them. Edit the generated schemas, handlers and policy into the requested domain afterwards: a generated capability starts with empty input and output and a headless UI exception, and a generated target starts with an in-memory fake port. Run `bun run typecheck`, `bun test`, `bun run build` and `bunx playwright test examples/<name>`. A cold dependency cache needs network access; an offline install failure is a dependency-fetch limitation, not an application check passing.

To start from a working reference instead, `bun run scaffold <absent-target> --name <app> --example project-tasks` exports one example as the hosted application. Do not present the example as the finished requested application. Customize the starter in `apps/*` freely, but put domain code in the content package, and keep the generic framework packages free of domain-specific imports.

For an application over existing systems of record, define one bounded interaction (see the [system-of-record pattern](../../../docs/system-of-record-pattern.md)): trigger, input/evidence, record authority, allowed outcomes and exception owner. Fit the UI to its input conditions while humans and agents share semantic capabilities. Start screens from the frame's registry in `packages/frame/src/components` (`capability-form` for a first pass) and the operator registry, with `examples/quality-inspection/ui/capture-station.tsx` as the pattern for high-frequency entry, and keep `useCapabilityForm` so retries reuse one idempotency key. Record capture timing so the time saved can be measured rather than assumed. Keep model inference optional for deterministic input paths.

Treat an upstream API as a connector to another authority, separately from local storage. A local receipt cannot prove remote acceptance. Implement a `SystemOfRecordPort` for the target and follow `examples/quality-inspection`: enqueue effects in commands, settle outcomes through a domain command under a narrowly granted integration principal, and pull master data with watermark-bound sync commands. The framework does not reconcile uncertain outcomes; design and test that path if the target can accept a write whose reply is lost and cannot deduplicate by effect ID; make those states queryable through the same catalog and visible in the UI. Do not perform external writes inside a local transaction or let a CLI bypass application policy with broad upstream credentials.

For agents in a sandbox, ship `bun run build:cli` output: `mcp --embedded --grant-file` serves them in-process under an orchestrator-written grant, and `drain` must exit 0 before the sandbox is discarded. Choose an actual isolation backend if the requested app runs arbitrary tool code. Current harness profiles are not an OS sandbox, and source export is not a signed update/fleet system. Use the [implementation status](../../../docs/implementation-status.md) for what is not implemented yet; report those gaps separately from scaffolding success.
