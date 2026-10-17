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

Each example uses both: `examples/<name>/test/conformance.test.ts` runs its scenarios through every driver, and `examples/<name>/test/ui-bindings.test.ts` expects `unboundOperations` to be empty.

## Trust boundary

Scenarios receive the `ExecutionContext` from the test, which stands in for the trusted host; they must never derive it from operation input. `assertEquivalent` compares canonical JSON, so key order cannot hide or fake a difference.

`unboundOperations` proves that a screen names a capability (`<contracts import>.<key>` in a `.tsx` file), not that a control renders it. Browser specs cover the reference screens, not every operation.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime` (types). Framework tests must never import an example; content imports this package, not the other way round.

## Tests

```sh
bun run test:conformance
```

This package has no suite of its own; it is exercised by the conformance and UI-binding tests of every example. Together they check that every operation behaves the same on every surface and that every operation claiming a UI binding is referenced by a screen.
