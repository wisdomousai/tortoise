# {{displayName}}

{{displayName}} is a generated application that starts with one {{one.words}} collection and default list and record screens. `scaffold new` wrote it as the only application of the project, and `app.config.json` selects it.

<!--
Replace the paragraph above with what the application is for, in the words of the domain: the job at its process step, the documents and systems that the plant already has, how the application fits that step and is easy to use there, and why the plant builds its own application for the step instead of changing the central system. Then replace the generated fields, access rules and screens with what that work needs. docs/styleguide.md has the rules for this README.
-->

## Running the application

From the project root:

```sh
bun run dev:web
```

The host prints a one-use launch link. `bun run dev` opens a desktop window instead. By default the host keeps the application's local workspace in `.workspace/`.

While the host runs, the CLI and the MCP server call the same instance through its connection file, which holds a local credential that only the owner can read. From the project root:

```sh
export TORTOISE_CONNECTION=$PWD/.workspace/.connection.json
bun run cli help
```

`bun run cli help` lists the application's operations. An MCP client such as Claude Code starts `bun run mcp` from the project root with the same variable.

## Code and tests

| Path | Contents |
| --- | --- |
| `contracts/{{one.kebab}}.ts` | The initial record and its generated reads and writes. |
| `handlers/{{one.kebab}}.ts` | The handlers of those operations. |
| `policy.ts` | Who may call each operation. |
| `ui/{{one.kebab}}.tsx` | The bindings of the default screens. |
| `manifest.ts`, `application.ts`, `screens.tsx` | The browser-safe declarations, the server and the screens. |
| `test/{{one.kebab}}.test.ts` | The initial behavior. |

`bun run scaffold add` inserts collections, capabilities, targets, agents, assignment kinds or features at the `// scaffold:<list>` markers, so keep the markers to use it. Generated parts are starting points and need the application's domain behavior.

From the project root:

```sh
bun test showcase/examples/{{app.kebab}}
bunx playwright test showcase/examples/{{app.kebab}}
```

The conformance test reads a list through the instance, HTTP, the CLI and MCP, and the UI-binding test checks the declared screen bindings. The browser test creates, opens and edits {{one.a}} with the default screens. Report a run against a real provider, device or system of record separately from these tests.

## Access and integrations

Only workspace members pass the policy's caller check. Editors run commands and viewers read, and the list handlers scope rows before filtering, counting and paging. Configure the members and the policy for the people who do the work.

The application composes the deployment, network, audit and compliance host plugins. An added target gives its integration principal no role and limits it to that target's operations. The target's generated connector is an in-memory fake, so implement and configure a real connector before treating another system's decision as known.

## References

- [Getting started](../../../docs/getting-started.md)
- [Systems of record](../../../docs/systems-of-record.md)
