# Oil lab test requests

A transformer maker's oil lab tests oil samples drawn from transformers. A technician submits a request to test a sample, another technician assigns the test method, such as dissolved gas analysis, and viewers read. Every other pattern imports this application unchanged and adds one concern.

```sh
cd showcase/patterns/base
bun run dev:web
```

## What to try

- Create a request (port 4350) with a sample, a transformer and a description, then open it and assign a method.
- Call the same instance from the CLI. From the repository root: `export AGENT_NATIVE_APPLICATION=@tortoise/pattern-base AGENT_NATIVE_CONNECTION=$PWD/showcase/patterns/base/.workspace/.connection.json`, then `bun run cli test-request list`.
- Point an MCP client at `bun run mcp` with the same two variables; it also offers `test-requests.assign-method` as a workflow resource.
- Update a request with an outdated expected revision and get `CONFLICT`.

## References

- [Patterns](../../../docs/patterns.md)
- [Getting started](../../../docs/getting-started.md)
- `bun test showcase/patterns/base`
