# Oil lab test requests

This hypothetical lab application supplies the unchanged base imported by the extension patterns. Its module declares test-request records and the operations that maintain them. A technician can submit or update a request; viewers have read access.

The base exports its contracts separately from server composition and screens. Each extension mounts those contributions and adds its own behavior without changing the base package.

```sh
cd showcase/patterns/base
bun run dev:web
```

## What to try

Create a request (port 4350) with a sample, a transformer and a description, then open it and assign a method.

Call the same instance from the CLI. From the repository root: `export TORTOISE_APPLICATION=@tortoise/pattern-base TORTOISE_CONNECTION=$PWD/showcase/patterns/base/.workspace/.connection.json`, then `bun run cli test-request list`.

Point an MCP client at `bun run mcp` with that environment; it also offers `test-requests.assign-method` as a workflow resource.

Update a request with an outdated expected revision and get `CONFLICT`.

## References

[Patterns](../../../docs/patterns.md)

[Getting started](../../../docs/getting-started.md)

`bun test showcase/patterns/base`
