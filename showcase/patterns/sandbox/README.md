# Analyze a lab result in a sandbox

A technician records the breakdown-voltage readings of an oil sample, and a result analyst tool calculates their statistics. This pattern adds the tool to the [base lab desk](../base/README.md) and runs it in the execution host's bubblewrap sandbox: the run gets a token limited to the analyst's read and analyze operations on the selected result, the host revokes it when the tool exits, and the sandbox mounts only the declared tool and its read-only dependencies. Without a sandbox, a technician enters the statistics by hand.

```sh
cd showcase/patterns/sandbox
bun run dev:web
```

## What to try

- Create a request (port 4360) and record readings such as `412`, `405`, `418` and `409`.
- On Linux with bubblewrap, **Analyze in the sandbox** records the statistics and the run ID; on macOS and Windows the screen offers manual entry instead.
- Open the result as a viewer: readable, but a viewer cannot record an analysis.
- `bun run test:execution-host:linux showcase/patterns/sandbox` runs the confined tool with its grant.

## References

- [Execution host](../../../plugins/execution-host/README.md)
- [run-agent-tools-in-a-sandbox](../../../plugins/execution-host/skills/run-agent-tools-in-a-sandbox/SKILL.md)
- `bun test showcase/patterns/sandbox`
