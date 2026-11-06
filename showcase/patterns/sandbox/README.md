# Analyze a lab result in a sandbox

This pattern executes a result-analysis tool through the execution-host plugin. It extends the hypothetical [base application](../base/README.md) with a result record and an analysis operation. The run token is limited to the selected record and the tool's declared operations.

On Linux, bubblewrap mounts the tool with its read-only dependencies. The host revokes the token when execution ends. Platforms without that sandbox use the screen's manual analysis entry.

```sh
cd showcase/patterns/sandbox
bun run dev:web
```

## What to try

Create a request (port 4360) and record readings such as `412`, `405`, `418` and `409`.

On Linux with bubblewrap, **Analyze in the sandbox** records the statistics and the run ID; on macOS and Windows the screen offers manual entry instead.

Open the result as a viewer and check that an analysis command is refused.

`bun run test:execution-host:linux showcase/patterns/sandbox` runs the confined tool with its grant.

## References

[Execution host](../../../plugins/execution-host/README.md)

[run-agent-tools-in-a-sandbox](../../../plugins/execution-host/skills/run-agent-tools-in-a-sandbox/SKILL.md)

`bun test showcase/patterns/sandbox`
