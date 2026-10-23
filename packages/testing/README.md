# @agent-native/testing

Shared test machinery for the framework's claim that a [capability](../../docs/glossary.md#capability) behaves the same on every [surface](../../docs/glossary.md#surface). A [behavioral scenario](../../docs/glossary.md#behavioral-scenario) runs against a `ScenarioDriver`, and `assertEquivalent` compares the outcomes of two runs. The [UI-binding](../../docs/glossary.md#ui-binding) helpers check that every capability claiming a UI binding is referenced by a [screen](../../docs/glossary.md#screen) of its application. [Agent scenarios](../../docs/glossary.md#agent-scenario) judge an agent definition's runs by their [receipts](../../docs/glossary.md#receipt) and [approval requests](../../docs/glossary.md#approval-request).

## Layer

Framework (`packages/*`). Test code; production code does not import it. Scenarios trust the test to supply the [execution context](../../docs/glossary.md#execution-context), as a host would.

## Primitives

- [Behavioral scenario](../../docs/primitives.md#behavioral-scenario): `BehavioralScenario`, `ScenarioDriver`, `runScenarios`, `directDriver`, `assertEquivalent`.
- [Model entry](../../docs/primitives.md#model-entry): `gateModel` produces the `ModelActivation` a managed model server requires.
- [Storage](../../docs/primitives.md#storage): `storageConformance`, `StorageHarness`, `ConformanceState`, `ConformanceStorage`, and `pgliteDriver`, an in-process Postgres `PgDriver`.
- [Feature](../../docs/primitives.md#feature): `featureConformance`, `FeatureConformanceOptions`, `FeatureRequest`.
- [Agent scenario](../../docs/primitives.md#agent-scenario): `AgentScenario`, `runAgentScenario`, `runAgentScenarios`, `assertAgentScenarios`, `scenarioRegressions`.

## Entrypoints

| Import                                  | Runs in        | Contents                                                                                       |
| --------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------- |
| `@agent-native/testing`                 | server (tests) | `scenarios`, `agent-scenarios` and `activation`.                                               |
| `@agent-native/testing/*`               | server (tests) | One source file: `scenarios`, `agent-scenarios`, `activation`, `ui-bindings`, `connectors`, `storage`, `features` or `postgres`. |
| `@agent-native/testing/scenarios`       | server (tests) | `ScenarioDriver`, `BehavioralScenario`, `directDriver`, `runScenarios`, `assertEquivalent`.    |
| `@agent-native/testing/activation`      | server (tests) | `gateModel`, `scenariosDigest`: the activation gate for a local model.                         |
| `@agent-native/testing/agent-scenarios` | server (tests) | `AgentScenario`, `runAgentScenario`, `runAgentScenarios`, `assertAgentScenarios`, `scenarioRegressions`, `containsValue`, `liveScenariosRequested`. |
| `@agent-native/testing/ui-bindings`     | server (tests) | `referencedCapabilities`, `unboundOperations`: a static scan of an application's screens.      |
| `@agent-native/testing/connectors`      | server (tests) | `connectorConformance`, `ConnectorHarness`, `conformanceEffect`: the connector contract.       |
| `@agent-native/testing/storage`         | server (tests) | `storageConformance`, `StorageHarness`: the cases any `Storage` adapter must pass.             |
| `@agent-native/testing/features`        | server (tests) | `featureConformance`: the cases any feature's handlers, slice and policy must pass.            |
| `@agent-native/testing/postgres`        | server (tests) | `pgliteDriver`: Postgres compiled to WebAssembly behind `PgDriver`, for tests without a server. |

### Behavioral scenarios and UI bindings

A `ScenarioDriver` sends commands and queries for one transport. The package ships `directDriver`, which calls the application's `invokeRaw` and `queryRaw`. `runScenarios` runs a list of scenarios on one driver. `assertEquivalent` compares two outcomes as canonical JSON.

Every example's `examples/<name>/test/ui-bindings.test.ts` expects `unboundOperations` to be empty. Five examples also have a `test/conformance.test.ts` that reads the same result through the instance, HTTP, the CLI and MCP. Those tests call the surfaces directly and do not use this package.

### Connector conformance

`connectorConformance(setup)` checks any `SystemOfRecordPort` the way the [dispatcher](../../docs/glossary.md#dispatcher) uses it. The port may be a [system-of-record](../../docs/glossary.md#system-of-record) client, a screen bridge or a hardware driver. Each case gets a fresh `ConnectorHarness` from `setup`, which holds:

- the port;
- a way to make effects the target applies or refuses;
- how often the target applied an effect;
- optional hooks to fail a delivery, lose a reply or add an item for `pull`.

The cases:

- the target is named, and a target without idempotent delivery has a lookup;
- an effect is applied once and a retry does not apply it again, through lookup when delivery is not idempotent;
- a refusal is returned as a rejection with a code and a message, and nothing is applied;
- a cancelled delivery fails and applies nothing;
- a transient failure throws something other than `DeliveryUncertain`, applies nothing, and the retry delivers;
- a lost reply is either `DeliveryUncertain` or found again on retry, and is not applied twice;
- `pull` resumes from its last cursor without repeating items.

A case returns `{ passed: true }`, or `{ skipped: reason }` when its hook is missing. A broken case throws a message naming the broken rule. The cases run under any test runner, and a connector's own command line can run them too.

### Storage conformance

`storageConformance(harness)` checks any `Storage` the way the composition uses it. Each case opens a fresh database from the harness, and a second `open` on it is what a restart sees. The cases:

- a commit stores state, journal, revisions and receipts together, and a reopen sees them;
- a transaction that throws commits nothing, before and after a reopen;
- a reader's mutation does not reach the next read or transaction;
- no transaction receives the initial state factory's object;
- concurrent transactions on one workspace run one after another;
- workspaces are independent;
- a removed record stays removed, and a stored `__proto__` key stays data;
- outbox effects and blob references are stored with the commit.

### Feature conformance

`featureConformance(feature, options)` checks a [feature](../../docs/glossary.md#feature)'s server part the way composition uses it. `options` holds an access view that answers yes to everything, one that answers no, a sample slice, and optionally sample requests, sample events and the person-only operations. The cases:

- every operation has one handler, every handler an operation, and a remote handler exactly when the operation declares `remote`;
- a new slice is unchanged by a JSON round trip and by `upgrade`;
- under the deny-all view every command is refused to a person and a delegated caller, and every sample request and event is refused;
- under the allow-all view a person passes every sample request and reads every sample event, which shows the policy reads the access view;
- under the allow-all view a delegated caller is refused every person-only operation.

Cases return results and throw as the connector cases do.

### Agent scenarios

An `AgentScenario` names an agent definition, the task a person gives it, who issues the run, the records it starts on and fixture `setup` commands. It states what must come out:

- **`commits`**: every command the run committed other than approval requests, in order, each with a subset of its input. A commit not listed fails the scenario.
- **`approvals`**: every `approval.request` the run made, by the requested capability's operation ID, a subset of its input and its record.
- **`refused`**: calls the application must have refused, with the error code.
- **`outcome`**: whether the run succeeded or failed.
- **`check(result, application)`**: anything further, such as a record read afterwards.

`runAgentScenario(scenario, { application, harness })`:

1. commits the setup;
2. starts the run in a run supervisor under `agentGrant` of the issuer, with the definition's budgets and model requirement;
3. offers the tools the grant names, in the `{ input, expectedRevisions }` envelope;
4. records every call with its receipt or refusal.

The text the run produced is not read. The function returns `{ passed, failures, calls, commits, approvals, state }` instead of throwing. `scenarioRegressions(candidate, baseline)` then lists the scenarios a new model fails that the current one passes. `assertAgentScenarios` throws with every failure, for a test.

With the deterministic [harness](../../docs/glossary.md#harness), the prompt is the scenario's `script`. With any other harness, it is the definition's instructions followed by the task. CI runs the deterministic harness only. A run against a model happens only when a test is given a configured harness and `AGENT_SCENARIOS=live` is set (`liveScenariosRequested()`). No credential is looked up.

Scenarios in a list share one application, each starting from the state the previous one left. A harness the supervisor refuses fails the scenario with state `refused`; the supervisor refuses a harness that does not meet a model requirement or named model. `result.model` is the model identity the run recorded.

### Model gate

`gateModel({ entry, candidate, baseline?, scenarios, application })` is the activation gate for a local model. It runs the scenarios on the candidate harness, which must serve `entry`, and on the baseline when one is given. Each run uses a fresh application from `application()`. It returns a `ModelActivation` with:

- the entry's digests;
- the digest of what the scenarios ask (`scenariosDigest`);
- each result and the regressions against the baseline.

The gate passes only when every scenario passes.

## Trust boundary

Scenarios receive the `ExecutionContext` from the test, which stands in for the trusted host. They must not derive it from capability input. An agent scenario's tools take their grants from the run's context only, never from the call, as the host's run tools do. `assertEquivalent` compares canonical JSON, so key order cannot hide or fake a difference.

`unboundOperations` proves that a screen names a capability (`<import>.<key>` in a `.tsx` file, for an import from a contracts module or a feature's or plugin's manifest entrypoint). It does not prove that a control renders it. Browser specs cover the reference screens, not every capability.

## Dependencies

Framework:

- `@agent-native/contracts`;
- `@agent-native/runtime`: types and `agentGrant`;
- `@agent-native/agents`: the run supervisor, for `agent-scenarios`;
- `@agent-native/integration`: the port and its errors, for `connectors`;
- `@agent-native/adapters`: the `PgDriver` type, for `postgres`.

External: `@electric-sql/pglite`. Framework tests must not import an example.

## Tests

```sh
bun test packages/testing
bun run test:conformance
```

- `test/storage.test.ts`: the storage cases against the memory, SQLite and Postgres (PGlite) storages, and against a Postgres server when `STORAGE_POSTGRES_URL` names one.
- `test/postgres-lease.test.ts`:
  - two hosts race for one workspace lease: one wins, a takeover after expiry gets a larger fence, and the old holder's commit and renewal are refused;
  - a lease is renewed while held, and released for the next host without waiting;
  - a second storage's commit invalidates the first one's cached snapshot;
  - the same cases run against the server.
- `test/peer-port.test.ts`: the connector cases against the peer port and a peer application served by the HTTP adapter; the reference read from the result, a held idempotency conflict, refused credentials and assertions kept pending, and search.
- `test/peer-target.test.ts`: a peer target delivering service commands as the service principal and personal ones as the mapped person, unmapped and disconnected effects kept pending, drift blocking until the peer agrees, and a peer source with page cursors bound to the query and the caller.
- `test/connectors.test.ts`: the connector cases against a conforming in-memory target, and against flawed ones (duplicates on retry, refusals thrown, abort ignored). Each flawed target fails with the rule it breaks.
- `test/features.test.ts`: the feature cases against a conforming ledger fixture, and against a missing handler, a policy that ignores the access view and a slice JSON cannot keep.
- `test/agent-scenarios.test.ts`: agent scenarios over a lots fixture, with the deterministic harness and a scripted model harness:
  - an approval request judged as passing;
  - a direct write and an approval request outside the selection refused;
  - extra commits and a wrong outcome failing;
  - the model's prompt, tools and budget, and regressions;
  - the model gate passing, failing with a regression and refusing a harness that serves another entry.

Elsewhere:

- `plugins/model-server` runs the gate against a managed server.
- `examples/receiving/test/agent-scenarios.test.ts` runs the discrepancy agent's scenarios.
- The behavioral scenario helpers have no suite of their own. `examples/project-tasks/test/storage-conformance.test.ts` and the scenario tests of the webhook, device-link, hub-link, station-sign-in and compliance plugins exercise them.
- The UI-binding helpers are exercised by the UI-binding test of every example.

## Skills

- [add-capability](../runtime/skills/add-capability/SKILL.md): commands, queries, policy, record shapes and triggers.
- [connect-system-of-record](../integration/skills/connect-system-of-record/SKILL.md): targets, outbox settlement, sync and live reads.
- [check-a-change](skills/check-a-change/SKILL.md): which checks to run and how to report the evidence.
