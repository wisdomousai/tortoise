# New application

Locate the framework checkout by its root `package.json` and `packages/scaffold/src/index.ts`. Run this from that checkout:

```sh
bun run scaffold new /absolute/path/to/absent-target --name my-application --display-name "My Application" --collection <record-type>
```

The generated application is in `showcase/examples/<name>`. `app.config.json` selects it. The destination must not exist; the scaffold does not initialize Git or install dependencies. Set a production application ID before distribution.

## Framework installation

A source export copies the framework workspaces. Install its pinned dependencies with `bun install --frozen-lockfile` from the exported root.

`--registry <url>` installs framework packages at the checkout's version from the configured registry. `--published` selects the public registry. A registry export has no lockfile initially; run `bun install` and retain the resulting lockfile. No framework version is currently published publicly. A configured registry can be exercised through the loopback service started by `bun run release:serve`.

The export excludes runtime data and dependency directories. It also omits symlinks and credential files. `scaffold.manifest.json` records the exported files and their hashes. Installation links the included task skills into the agent discovery directories.

## Adding application behavior

Run `scaffold add` from the exported repository root. Use the operation appropriate to the requested change:

```sh
bun run scaffold add collection <record-type>
bun run scaffold add capability <dotted.operation-id> --kind command|query --description "<operation and permission>"
bun run scaffold add target <system-name> --collection <record-type>
bun run scaffold add agent <agent-name> --collection <record-type>
bun run scaffold add assignment-kind <kind-id> --collection <record-type>
bun run scaffold add feature <feature-id> [--screens]
```

Insertions depend on the `// scaffold:<list>` markers. Preserve them. Generated policy insertions use the `editor` rule. Generated handlers and tests can refer to the original record's `title` or `status`. Adjust these references after changing the application's roles or stored shape.

A new capability has empty schemas and a headless UI exception. Implement the requested contract and its handler before binding a screen. A generated target starts with an in-memory fake port. Configure its real delivery behavior through [connect-system-of-record](../../../../integration/skills/connect-system-of-record/SKILL.md).

A generated agent initially requests approval for the collection's update command. Rewrite its grant and instructions for the requested task, with scenarios for the permitted and refused calls. Assignment kinds need application-specific instructions and report acceptance hooks; follow [assign-work](../../../../assignments/skills/assign-work/SKILL.md). A feature's generated slice and access view must be shaped to the reusable behavior, following [write-a-feature](../../../../host/skills/write-a-feature/SKILL.md).

## Checks and execution

Run from the exported root:

```sh
bun run format
bun run generate
bun run typecheck
bun test showcase/examples/<name>
bun run build
bunx playwright test showcase/examples/<name>
```

A cold dependency cache needs network access. Source exports can report skill links to omitted demonstrations; record that full-check limitation separately from the application checks.

For a specifically requested existing application, `bun run scaffold <absent-target> --name <app> --example <name>` exports that application's source. Domain code stays in its application workspace. Framework packages must remain free of domain-specific imports.

For an application run inside an agent sandbox, compile with `bun run build:cli`. `mcp --embedded --grant-file <file>` opens the instance under the supplied grant. A sandbox with external deliveries needs to run `drain` before its workspace is discarded. Process identity alone does not provide isolation; configure the [execution host](../../../../../plugins/execution-host/skills/run-agent-tools-in-a-sandbox/SKILL.md) when tools execute untrusted code. Use [deploy-an-application](../../../../../plugins/deployment/skills/deploy-an-application/SKILL.md) for signed installation.
