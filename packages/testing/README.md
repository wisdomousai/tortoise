# @agent-native/testing

Shared test machinery for the framework's central claim: the same operation behaves the same on every surface. A behavioral scenario runs against a `ScenarioDriver`, and the same scenario runs through the direct, HTTP, CLI and MCP drivers, whose results and structured errors must agree. The UI-binding helpers check that every operation that claims a UI binding is referenced by a screen of its application.

Layer: framework (`packages/*`). Test code; production code never imports it.

## Primitives

- [Behavioral scenario](../../docs/primitives.md#behavioral-scenario): `BehavioralScenario`, `ScenarioDriver`, `runScenarios`, `directDriver`, `assertEquivalent`.

## Entrypoints

| Import                              | Runs in        | Contents                                                                                    |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| `@agent-native/testing`             | server (tests) | `ScenarioDriver`, `BehavioralScenario`, `directDriver`, `runScenarios`, `assertEquivalent`. |
| `@agent-native/testing/*`           | server (tests) | One source file: `scenarios` (what the root exports) or `ui-bindings`.                      |
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

## Trust boundary

Scenarios receive the `ExecutionContext` from the test, which stands in for the trusted host; they must never derive it from operation input. `assertEquivalent` compares canonical JSON, so key order cannot hide or fake a difference.

`unboundOperations` proves that a screen names a capability (`<contracts import>.<key>` in a `.tsx` file), not that a control renders it. Browser specs cover the reference screens, not every operation.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime` (types), `@agent-native/integration` (the port and its errors, for `connectors`). Framework tests must never import an example; content imports this package, not the other way round.

## Tests

```sh
bun test packages/testing
bun run test:conformance
```

`test/connectors.test.ts` runs the connector cases against a conforming in-memory target. It also runs them against flawed ones (duplicates on retry, refusals thrown, abort ignored), and each fails with the rule it breaks. The scenario and UI-binding helpers have no suite of their own; they are exercised by the conformance and UI-binding tests of every example. Together they check that every operation behaves the same on every surface and that every operation claiming a UI binding is referenced by a screen.
