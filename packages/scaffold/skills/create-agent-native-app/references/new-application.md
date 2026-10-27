# New application

Locate the source checkout by its root `package.json` and `packages/scaffold/src/index.ts`; do not assume a machine-specific path. From that checkout run:

```sh
bun run scaffold new /absolute/path/to/absent-target --name my-application --display-name "My Application" --collection <record-type>
```

The command exports the framework, the starter and a generated application in `showcase/examples/<name>`, with no example copied. The root manifest, the lockfile and `app.config.json` name it as the hosted application. Framework packages are copied as local workspaces unless `--published` (npm's registry) or `--registry <url>` (a registry for the `@agent-native` scope, written to `bunfig.toml`) is given; then `packages/*`, `plugins/*`, `sdks/*` and the lockfile are left out, the root depends on every framework package at the checkout's framework version, and the first `bun install` writes the lockfile to commit. No framework version is on a public registry yet, so use `--registry` with a registry someone configured, or `bun run release:serve` for a loopback one. It excludes dependency directories, build output, workspace data, credentials, agent configuration directories and symlinks, and refuses any existing target. `scaffold.manifest.json` records the framework version and SHA-256 of exported files. The export does not initialize Git or install dependencies. Set a production app ID in `app.config.json` before distributing the application.

In the new checkout install the pinned dependencies with `bun install --frozen-lockfile`; its `postinstall` links the skills for the coding agent. Grow the application with generated parts, each with its contract, handlers, policy rule, screens where it has any and a behavioral test:

```sh
bun run scaffold add collection <record-type>
bun run scaffold add capability <dotted.operation-id> --kind command|query --description "<what it does, for whom>"
bun run scaffold add target <system-name> --collection <record-type>
bun run scaffold add agent <agent-name> --collection <record-type>
bun run scaffold add assignment-kind <kind-id> --collection <record-type>
bun run scaffold add feature <feature-id> [--screens]
bun run format && bun run generate
```

`add` inserts at the `// scaffold:<list>` markers in the generated files; keep them. Edit the generated schemas, handlers and policy into the requested domain afterwards: a generated capability starts with empty input and output and a headless UI exception, a generated target starts with an in-memory fake port, a generated agent requests approval only for `<record-type>.update` until its instructions and operations are rewritten for the domain, a generated assignment kind sets a record's status from a person's report until its scope, brief, report and accept hook are rewritten (the `assign-work` skill), and a generated feature holds text entries until its slice, operations and access view are rewritten (the `write-a-feature` skill). Run `bun run typecheck`, `bun test`, `bun run build` and `bunx playwright test showcase/examples/<name>`. A cold dependency cache needs network access.

To start from a working reference instead, `bun run scaffold <absent-target> --name <app> --example field-service` exports one example as the hosted application. Do not present the example as the finished requested application. Customize the starter in `apps/*` freely, but put domain code in the application, and keep the framework packages free of domain-specific imports.

For an application over existing systems of record, define one bounded interaction (see the [system-of-record pattern](../../../../../docs/systems-of-record.md)): trigger, input or evidence, the system of record, allowed outcomes and exception owner. The `connect-system-of-record` skill covers the connector, settlement and held effects.

For agents in a sandbox, ship `bun run build:cli` output: `mcp --embedded --grant-file` serves them in-process under an orchestrator-written grant, and `drain` must exit 0 before the sandbox is discarded. A process running as the same OS user is not a sandbox ([agent harnesses](../../../../../docs/agents.md)), so choose an actual isolation backend if the requested application runs arbitrary tool code. For signed site bundles and `app install`, follow the `deploy-to-site` skill.
