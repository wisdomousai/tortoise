# Analyze a lab result in a sandbox

A technician records breakdown-voltage readings for an oil sample. The result analyst tool reads those readings through the application CLI, calculates statistics and records the analysis. This pattern runs the tool inside the [execution host](../../../docs/primitives.md#execution-host)'s bubblewrap sandbox; a technician can enter statistics by hand when the sandbox is unavailable.

## Try the analysis

From the repository root:

```sh
cd showcase/patterns/sandbox
bun run dev:web
```

Create a test request and record readings such as `412`, `405`, `418` and `409`. On Linux with bubblewrap, **Analyze in the sandbox** records the statistics and run ID. On macOS and Windows, the screen reports that the sandbox is unavailable and offers manual entry.

## What the sandbox can do

The run receives a token limited to the analyst's read and analyze operations for the selected result. The host revokes the token when the tool exits, and policy still checks each call. A viewer can read the result but cannot record the analysis.

The sandbox mounts the declared tool and read-only dependencies, not the rest of the checkout or other workspaces' connection files. No external destinations are declared. [`tools/analyze.ts`](tools/analyze.ts) calls the CLI; [`tools/statistics.ts`](tools/statistics.ts) computes the statistics; [`plugins/result-analysis`](plugins/result-analysis) starts the run.

## Checks

```sh
bun test showcase/patterns/sandbox
bun run test:execution-host:linux showcase/patterns/sandbox
```

The ordinary tests cover manual entry and unavailable sandbox behavior. The Linux bubblewrap suite exercises the confined tool and grant; it is a separate platform check.
