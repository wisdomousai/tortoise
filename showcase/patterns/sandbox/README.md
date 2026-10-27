# @agent-native/pattern-sandbox

`pattern-sandbox` composes the [base pattern](../base/README.md) unchanged with test results and the [execution host](../../../docs/glossary.md#execution-host). A technician records the breakdown voltage of each fill of the test cell for a test request. The result analyst's tool then runs in a bubblewrap sandbox, reads the readings through the application CLI and records their statistics. On a platform without bubblewrap, the request screen says why the sandbox cannot run, and technicians enter the statistics by hand.

## Layer

Content (`showcase/patterns/*`). It imports the base pattern, the framework and the site, network, process and execution host plugins. Its own `result-analysis` plugin lives in `plugins/result-analysis` inside the pattern.

## Primitives

The pattern is one [application](../../../docs/primitives.md#application). It composes:

- [collection](../../../docs/primitives.md#collection): `test-result`, with a list filtered by test request;
- [agent definition](../../../docs/primitives.md#agent-definition): the result analyst, a direct agent scoped to the one result its run starts on;
- [execution host](../../../docs/primitives.md#execution-host): the `analysis-tools` sandbox, declared with `executionSandbox`, with no destinations;
- [execution context](../../../docs/primitives.md#execution-context): the run's grant from `agentGrant`, and the run-bound token the sandbox calls the host with;
- [host plugin](../../../docs/primitives.md#host-plugin): `result-analysis`, whose two routes start a run and report the sandbox's availability;
- [policy](../../../docs/glossary.md#policy): technicians record readings and statistics, viewers read, and a run reads and analyzes only its result.

Its own files:

| File | Runs in | Holds |
| --- | --- | --- |
| `contracts.ts` | Browser and server | The `test-result` collection, its four operations and the result analyst |
| `domain.ts` | Server | The `testResults` slice beside the base pattern's `testRequests` slice |
| `handlers.ts` | Server | The results handlers; the analysis takes its run from the caller's context |
| `policy.ts` | Server | The results policy and its authorization route |
| `manifest.ts` | Browser and server | Both modules, the sandbox and the five plugin manifests |
| `application.ts` | Server | `createTestRequestsSandboxApplication`, with the execution host mounting this Bun as its one tool |
| `plugins/result-analysis/plugin-manifest.ts` | Browser and server | The plugin manifest, its route paths and the sandbox ID |
| `plugins/result-analysis/plugin.ts` | Server | `analyzeResult` and the plugin's routes |
| `tools/analyze.ts` | Sandbox | The analysis tool: `test-result get`, then `test-result analyze`, through the CLI run in process |
| `tools/statistics.ts` | Sandbox and tests | `summarize`: count, mean, range and sample standard deviation |
| `ui/results.tsx` | Browser | `ResultsSection`: results, the readings form, the sandbox status and the hand-entry form |
| `screens.tsx` | Browser | The base screens with `ResultsSection` on the request screen |
| `dev.ts` | Development launch | On Linux with bubblewrap, a policy that binds the sandbox to `/usr/bin/bwrap` |

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/pattern-sandbox/manifest` | Browser and server | The test requests and test results modules, the sandbox and the plugin manifests |
| `@agent-native/pattern-sandbox/application` | Server | `createTestRequestsSandboxApplication`; the default export is one with default options |
| `@agent-native/pattern-sandbox/screens` | Browser | The test request screens with test results |

## Trust boundary

The `result-analysis` routes act as the signed-in caller. The run route builds the run's grant with `agentGrant`, which narrows the caller to the analyst's two operations and to the one result. The execution host issues a token for that grant and run, and revokes it when the tool exits. Policy still decides each call, so a viewer's run reads the result and its analysis is refused.

The sandbox holds the tool, Bun and the paths `analysisReadOnly` lists: the installed packages, `packages/` and the pattern's `tools/` directory. It does not see the rest of the checkout, because the workspaces of patterns and examples hold their owners' connection files. An owner's token would act outside the run's grant. The sandbox declares no destinations, so it reaches only the host's API.

`analysisRun` comes from the caller's context, which the token carries, so the tool cannot claim a run. Statistics a technician enters by hand record no run.

## Dependencies

`@agent-native/pattern-base`, `@agent-native/execution-host`, `@agent-native/site`, `@agent-native/network`, `@agent-native/process`, `@agent-native/adapters`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/frame`, and in tests `@agent-native/testing`. On Linux the sandbox needs bubblewrap 0.8 or later.

## Tests

```sh
bun test showcase/patterns/sandbox/
bun run test:execution-host:linux showcase/patterns/sandbox
```

- `test/results.test.ts`, on any platform:
  - `summarize` on four readings and on one.
  - A technician records readings for a submitted request and enters statistics by hand, which record no run. A viewer can do neither, and readings for an unknown request are `NOT_FOUND`.
  - With no bubblewrap bound, the status route answers the execution host's reason, and the run route answers `UNAVAILABLE` with 503.
  - `analysisReadOnly` contains no workspace of the checkout.
- `test/sandbox.test.ts`, only on Linux with bubblewrap:
  - The owner's run, started through the route, reads and records through the CLI in the sandbox. The analysis equals `summarize`, and `analysisRun` is the run's ID.
  - A viewer's run reads the result, its `test-result analyze` call is `FORBIDDEN`, and the result keeps no analysis.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen in this pattern or the base.

Run the pattern in the browser:

```sh
cd showcase/patterns/sandbox
bun run dev:web
```

Submit a test request and record readings such as `[412, 405, 418, 409]`. On Linux with bubblewrap, **Analyze in the sandbox** records the statistics with the run's ID. On macOS and Windows, the section shows the reason the sandbox is unavailable.

## Skills

- [run-agent-tools-in-a-sandbox](../../../plugins/execution-host/skills/run-agent-tools-in-a-sandbox/SKILL.md)
- [write-host-plugin](../../../packages/host/skills/write-host-plugin/SKILL.md)
- [add-capability](../../../packages/runtime/skills/add-capability/SKILL.md)

## References

- [Patterns](../../../docs/patterns.md)
- [Execution host](../../../plugins/execution-host/README.md)
- [Agents: harnesses](../../../docs/agents.md#harnesses)
- [Security and compliance: agent tool sandboxes](../../../docs/security-and-compliance.md#agent-tool-sandboxes)
