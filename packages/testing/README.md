# @agent-native/testing

Shared test machinery for the framework's central claim: the same operation behaves the same on every surface. A behavioral scenario runs against a `ScenarioDriver`, and the same scenario runs through the direct, HTTP, CLI and MCP drivers, whose results and structured errors must agree. The UI-binding helpers check that every operation that claims a UI binding is referenced by a screen of its application. Agent scenarios judge an agent definition's runs by their receipts and proposals.

Layer: framework (`packages/*`). Test code; production code never imports it.

## Primitives

- [Behavioral scenario](../../docs/primitives.md#behavioral-scenario): `BehavioralScenario`, `ScenarioDriver`, `runScenarios`, `directDriver`, `assertEquivalent`.
- [Agent scenario](../../docs/primitives.md#agent-scenario): `AgentScenario`, `runAgentScenario`, `runAgentScenarios`, `assertAgentScenarios`, `scenarioRegressions`.

## Entrypoints

| Import                              | Runs in        | Contents                                                                                    |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| `@agent-native/testing`             | server (tests) | `scenarios` and `agent-scenarios`.                                                          |
| `@agent-native/testing/*`           | server (tests) | One source file: `scenarios`, `agent-scenarios`, `ui-bindings` or `connectors`.             |
| `@agent-native/testing/scenarios`   | server (tests) | `ScenarioDriver`, `BehavioralScenario`, `directDriver`, `runScenarios`, `assertEquivalent`. |
| `@agent-native/testing/agent-scenarios` | server (tests) | `AgentScenario`, `runAgentScenario`, `runAgentScenarios`, `assertAgentScenarios`, `scenarioRegressions`, `containsValue`, `liveScenariosRequested`. |
| `@agent-native/testing/ui-bindings` | server (tests) | `referencedCapabilities`, `unboundOperations`: static scan of an application's screens.     |
| `@agent-native/testing/connectors`  | server (tests) | `connectorConformance`, `ConnectorHarness`, `conformanceEffect`: the connector contract.    |

Each example uses both: `examples/<name>/test/conformance.test.ts` runs its scenarios through every driver, and `examples/<name>/test/ui-bindings.test.ts` expects `unboundOperations` to be empty.

`connectorConformance(setup)` checks any `SystemOfRecordPort` (a system-of-record client, a screen bridge, a hardware driver) the way the dispatcher uses it. Each case gets a fresh `ConnectorHarness` from `setup`: the port, a way to make effects the target applies or refuses, how often the target applied an effect, and optional hooks to fail a delivery, lose a reply or add an item for `pull`. The cases:

- the target is named, and a target without idempotent delivery has a lookup;
- an effect is applied once and a retry does not apply it again, through lookup when delivery is not idempotent;
- a refusal is returned as a rejection with a code and a message, and nothing is applied;
- a cancelled delivery fails and applies nothing;
- a transient failure throws something other than `DeliveryUncertain`, applies nothing, and the retry delivers;
- a lost reply is either `DeliveryUncertain` or found again on retry, never applied twice;
- `pull` resumes from its last cursor without repeating items.

A case returns `{ passed: true }`, or `{ skipped: reason }` when its hook is missing, and throws a message naming the broken rule. It runs under any test runner; a connector's own command line can run it too.

## Agent scenarios

An `AgentScenario` names an agent definition, the task a person gives it, who issues the run, the records it starts on, fixture `setup` commands and what must come out:

- `commits`: every command the run committed other than proposals, in order, each with a subset of its input. A commit not listed fails the scenario.
- `proposals`: every `proposal.submit` the run made, by the proposed operation, a subset of its input and its record.
- `refused`: calls the application must have refused, with the error code.
- `outcome`: whether the run succeeded or failed.
- `check(result, application)`: anything further, such as a record read afterwards.

`runAgentScenario(scenario, { application, harness })` commits the setup, starts the run in a run supervisor under `agentGrant` of the issuer with the definition's budgets and model requirement, offers the tools the grant names in the `{ input, expectedRevisions }` envelope, and records every call with its receipt or refusal. The text the run produced is never read. It returns `{ passed, failures, calls, commits, proposals, state }` instead of throwing, so `scenarioRegressions(candidate, baseline)` can list the scenarios a new model fails that the current one passes. `assertAgentScenarios` throws with every failure, for a test.

With the deterministic harness the prompt is the scenario's `script`; with any other harness it is the definition's instructions followed by the task. CI runs the deterministic harness only. A run against a model happens only when a test is given a configured harness and `AGENT_SCENARIOS=live` is set (`liveScenariosRequested()`); no credential is looked up. Scenarios in a list share one application, each starting from the state the previous one left.

## Trust boundary

Scenarios receive the `ExecutionContext` from the test, which stands in for the trusted host; they must never derive it from operation input. An agent scenario's tools take authority from the run's context only, never from the call, as the host's run tools do. `assertEquivalent` compares canonical JSON, so key order cannot hide or fake a difference.

`unboundOperations` proves that a screen names a capability (`<contracts import>.<key>` in a `.tsx` file), not that a control renders it. Browser specs cover the reference screens, not every operation.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime` (types and `agentGrant`), `@agent-native/agents` (the run supervisor, for `agent-scenarios`), `@agent-native/integration` (the port and its errors, for `connectors`). Framework tests must never import an example; content imports this package, not the other way round.

## Tests

```sh
bun test packages/testing
bun run test:conformance
```

`test/connectors.test.ts` runs the connector cases against a conforming in-memory target. It also runs them against flawed ones (duplicates on retry, refusals thrown, abort ignored), and each fails with the rule it breaks. `test/agent-scenarios.test.ts` runs agent scenarios over a lots fixture with the deterministic harness and a scripted model harness: a proposal judged as passing, a direct write and a proposal outside the selection refused, extra commits and a wrong outcome failing, the model's prompt, tools and budget, and regressions. `examples/receiving/test/agent-scenarios.test.ts` runs the discrepancy agent's scenarios. The behavioral scenario and UI-binding helpers have no suite of their own; they are exercised by the conformance and UI-binding tests of every example. Together they check that every operation behaves the same on every surface and that every operation claiming a UI binding is referenced by a screen.

## Skills

- [add-capability](../runtime/skills/add-capability/SKILL.md): commands, queries, policy, record shapes and triggers.
- [connect-system-of-record](../integration/skills/connect-system-of-record/SKILL.md): targets, outbox settlement, sync and live reads.
- [check-a-change](skills/check-a-change/SKILL.md): which checks to run and how to report the evidence.
