# Getting started

Build a small application around one task at one site. This guide starts an inspection desk with a generated inspection record, then shows where to add the real fields, rules and screens. The scaffold is a starting point: it does not yet know what an inspection means at your site or send a result to a quality system.

Before you start, identify who does the work, what triggers it, what evidence they capture and whether another system must accept the result. The [library tutorial](tutorial-library.md) develops a complete local workflow; the [tool crib tutorial](tutorial.md) also connects an external system and prepares a site install.

## New application

Install Bun 1.4.4, the version pinned in this repository. From the framework repository root, install its dependencies and export a new application. Replace the path below with an absolute path **outside this repository** that does not already exist:

```sh
bun install --frozen-lockfile
bun run scaffold new /absolute/path/inspection-desk --name inspection-desk --display-name "Inspection Desk" --collection inspection
```

The scaffold creates a separate directory containing the framework source, the starter and an application in `showcase/examples/inspection-desk`. It refuses to overwrite a directory and does not copy workspace data or credentials. `app.config.json` selects the new application; `scaffold.manifest.json` records the exported files and their hashes.

In the new directory, install its pinned dependencies:

```sh
cd /absolute/path/inspection-desk
bun install --frozen-lockfile
```

The generated collection has a title, an `open` or `done` status, an author and a creation time. It includes commands to create and update records, queries to read them, default list and record screens, a policy and tests. The workspace owner is an editor; other members need to be configured. This is deliberately generic, not an inspection implementation.

## Shape the task

Work in `showcase/examples/inspection-desk` in the new directory:

- **Record and operations:** `contracts/inspection.ts` declares the record and generated commands and queries. Add the facts the inspector needs to capture, such as an equipment identifier and measurement.
- **Behavior:** `handlers/inspection.ts` supplies the collection's handler hooks. Add validation and domain rules for those facts.
- **Access:** `policy.ts` defines who may read and change records. Adjust it for the people and roles at the site.
- **Screens:** `ui/inspection.tsx` binds the generated list and record screens. Replace or extend them when the actual capture task needs a different interaction.
- **Composition and tests:** `manifest.ts` declares browser-safe parts; `application.ts` composes the server; `screens.tsx` composes the screens. Update `test/inspection.test.ts` and the application tests to exercise permitted and refused work.

For example, to require an equipment ID, add this property to `inspectionSchema` in `contracts/inspection.ts`:

```ts
equipmentId: z.string().min(1).max(80),
```

Add `'equipmentId'` to the `fields` arrays of both `collectionCreate` and `collectionUpdate` in the same file. The create input now requires it, while the update input can change it. Update the test data in `test/inspection.test.ts`, `test/conformance.test.ts` and `e2e/default-screens.pw.ts`, and add cases for an empty or invalid ID. The default screens use the declared inputs; replace them if the inspector needs a scanner or a more specialized capture flow.

Keep the `// scaffold:<list>` markers if you want `scaffold add` to insert later parts. For example, `bun run scaffold add capability <operation-id> --kind command --description "<what it does>"` generates a contract, handler, policy rule and test. Its initial handler still needs the domain behavior. The [capability authoring guide](capability-authoring.md) walks through those pieces.

If a quality system must decide whether to accept an inspection, add a target and implement its connector and completion behavior using [systems of record](systems-of-record.md). The generated target begins with an in-memory fake; generating it alone does not connect a real system.

## Run and check the application

From the new application's root, start its browser host:

```sh
bun run dev:web
```

Open the one-use launch link printed by the host; it expires after one minute. The default **Inspections** screen can create a record from the declared inputs and open it for editing. Try a title and the equipment ID you added above. For a desktop window instead, run `bun run dev` from the same directory.

The host keeps its local workspace in `.workspace/` by default; set `WORKSPACE_PATH` to use a different directory. Only one instance may write a local workspace at a time. The desktop can attach to a running instance; a second embedded writer receives `CONFLICT`. The CLI and MCP can attach to the serving host through its connection file. A [hosted instance](hosting.md#hosted-instance) is reached in attached mode and stores its workspace in Postgres.

Run the generated application's deterministic tests and build from its root:

```sh
bun run format
bun run generate
bun run typecheck
bun test showcase/examples/inspection-desk
bun run build
```

The source export's `bun run check:skills` currently reports references to omitted examples and patterns and a removed root script, so the full `bun run check` cannot pass unchanged. The focused commands above do not establish a browser, device or live quality-system run. For the generated browser test, install the Playwright browser and run `bunx playwright test showcase/examples/inspection-desk`.

## Command line

While the host is running, its startup output gives the connection file path. The file contains a local credential with owner-only permissions; keep it private. From the new application's root, point the CLI at it and list the application's catalog:

```sh
export AGENT_NATIVE_CONNECTION="$(pwd)/.workspace/.connection.json"
bun run cli list
bun run cli inspection create --title "Check pump 4" --equipment-id PUMP-4 --key inspection-pump-4
bun run cli inspection list
```

The example assumes you added `equipmentId` above and use the default workspace path. If you set `WORKSPACE_PATH`, use the connection file shown in the host's output instead. `--key` supplies a command's [idempotency key](glossary.md#idempotency-key); queries do not need one. `bun run cli help <capability>` describes a generated command. The CLI uses the application selected by `app.config.json`.

`bun run mcp` serves the same catalog as MCP tools over stdio, forwarding calls to the host named by `AGENT_NATIVE_CONNECTION`. Configure an MCP client to launch it with that environment variable. Commands take `input`, an `idempotencyKey` and optional `expectedRevisions`; queries take `input`. The caller's identity and grant come from the session or grant file, not tool arguments. An embedded MCP bridge can open a local workspace without a listening port, subject to the same single-writer rule.

`bun run generate` writes the capability reference, OpenAPI document and application skill to `dist/reference/<id>/`. These are generated outputs for reading; do not commit them.

## Explore an example

The framework repository also contains working reference applications. They help you inspect a particular implementation before adapting the ideas to your own task. From the framework repository, for example:

```sh
cd showcase/examples/quality-inspection
bun run dev:web
```

That example captures measurements against a **fake** quality system. Its [README](../showcase/examples/quality-inspection/README.md) explains the capture and rejection flows. [Receiving](../showcase/examples/receiving/README.md) shows a file exchange with an ERP; [winding-line](../showcase/examples/winding-line/README.md) shows a workstation bridge; [asset-survey](../showcase/examples/asset-survey/README.md) and [asset-survey-field](../showcase/examples/asset-survey-field/README.md) show a hub and mobile application. The [patterns](patterns.md) isolate individual framework concerns on a shared oil-lab example.

## Other export options

A source export copies the framework into the new project. To install its packages from a configured registry instead, pass `--registry <url>` to `scaffold new`; `--published` selects npm. A registry export has no lockfile yet, so its first installation uses `bun install` without `--frozen-lockfile`. No framework version has been published to a public registry; `bun run release:serve` offers a loopback registry for trying the flow.

To start from an existing reference application, use `bun run scaffold /absolute/path/to/new-app --name new-app --example field-service`. An export does not initialize Git or install dependencies. A coding agent can follow [create-agent-native-app](../packages/scaffold/skills/create-agent-native-app/SKILL.md); the other task guides are listed in [AGENTS.md](../AGENTS.md#skills).
