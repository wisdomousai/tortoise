# @agent-native/quality-inspection

Quality inspection capture on top of an external quality system of record. The system of record owns inspection lots, specifications and code catalogs, which arrive through the integration principal's sync command. This application owns what is recorded at the moment of inspection: results, defects and usage decisions, each forwarded to the system of record through the outbox. Records are append-only; a correction supersedes a result instead of editing it. Inspectors, supervisors and viewers hold roles per plant.

Layer: content (`examples/*`). The demo quality system ([`fake-sor.ts`](fake-sor.ts)) lives here and is wired only by this application's `connect`.

## Primitives

This example is one [Application](../../docs/primitives.md#application) and the reference for the system-of-record pattern. It composes:

- a [Module](../../docs/primitives.md#module) of `inspection.*` [capabilities](../../docs/primitives.md#capability), plus `assurance`;
- [Outbox effects](../../docs/primitives.md#outbox-effect) for every captured record, delivered by a [Dispatcher](../../docs/primitives.md#dispatcher) through a [Connector](../../docs/primitives.md#connector), and [Inbound sync](../../docs/primitives.md#inbound-sync) of lots and code groups;
- [Capability bindings](../../docs/primitives.md#capability-binding) for keyboard-first capture (`useCapabilityForm`, capture timing and wedge-scan routing);
- the frame's [registry](../../docs/primitives.md#ui-registry) parts (`capability-form`, `live-data-table`, `security-screen`).

Read the [system-of-record pattern](../../docs/system-of-record-pattern.md). The generated [operation reference](../../docs/reference/quality-inspection/operations.md) lists every operation.

## Entrypoints

| Import                                         | Runs in            | Contents                                                                                                    |
| ---------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `@agent-native/quality-inspection/manifest`    | browser and server | Default export: `defineManifest` with id `quality-inspection`.                                              |
| `@agent-native/quality-inspection/application` | server only        | Default export: `defineApplication`, with `connect` wiring the quality-system target.                       |
| `@agent-native/quality-inspection/screens`     | browser            | Default export: `defineScreens` with Inspection, Capture, Synchronization and Security, and the sync badge. |
| `@agent-native/quality-inspection/*`           | see file           | Other modules by name: `contracts` (browser-safe), `domain`, `policy`, `server`, `fake-sor`.                |

Run it with `bun run dev` or `bun run dev:web` in this directory; port 4322. `DEMO_QUALITY_LOCKED_LOTS=<lot>,<lot>` makes the fake system reject forwarded records for those lots, as if another user held a lock, and `DEMO_QUALITY_UNAVAILABLE=1` makes every delivery fail transiently. Resolve both under **Synchronization**. The framework never reads these variables.

## Trust boundary

Plant roles come from state, and handlers scope lots and results to the caller's plants before filtering, counting and pagination. The quality-system integration runs as its own principal (`INTEGRATION_PRINCIPAL`), whose grant can sync and settle but cannot capture. A commit receipt proves the local write only; the sync badge and synchronization screen show whether the system of record has accepted it. Capture telemetry measures interface economics and never influences authorization.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/integration`, `@agent-native/frame`, `@agent-native/react`, `@agent-native/assurance`, and `@agent-native/testing` (tests). External: `zod`, `react`, `@tanstack/react-query`, `@tanstack/react-router`, `lucide-react`. Content must never import `apps/*` ([P11](../../docs/principles.md#p11--framework-starter-and-content-are-separate-layers-and-an-authority-runs-one-application)).

## Tests

```sh
bun test examples/quality-inspection
bun run test:sandbox
bunx playwright test examples/quality-inspection/e2e
```

| Test                       | Proves                                                                                                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain.test.ts`           | Watermarked inbound sync, plant-scoped lists and events, one datapoint per idempotency key, all-or-nothing batches, role rules, SoR outcomes and corrections, outage behavior, metrics.                                                                                         |
| `test/conformance.test.ts` | A datapoint captured over any transport commits once, is forwarded once and settles live ([P1](../../docs/principles.md#p1--every-operation-is-executable-from-ui-mcp-cli-and-api), [P7](../../docs/principles.md#p7--other-systems-are-reached-only-through-durable-intents)). |
| `test/application.test.ts` | The embedded authority syncs and drains the target it declares ([P6](../../docs/principles.md#p6--status-reports-what-is-known-not-what-is-hoped)).                                                                                                                             |
| `test/sandbox.test.ts`     | The compiled binary with an empty environment: embedded MCP capture under a grant, drain exit codes, grant-bound `serve` ([P12](../../docs/principles.md#p12--an-application-runs-beside-the-work-and-keeps-working-without-central-systems-or-a-model)).                       |
| `test/security.test.ts`    | Auditors read posture over HTTP; the CLI verifies, reports and detects tampering.                                                                                                                                                                                               |
| `test/ui-bindings.test.ts` | Every operation that claims a UI binding is referenced by a screen.                                                                                                                                                                                                             |
| `e2e/inspection.pw.ts`     | Chromium: keyboard-only capture, wedge bursts and double Enter record once, live SoR outcomes, drafts keep their sample.                                                                                                                                                        |
| `e2e/security.pw.ts`       | The Security screen shows a new denial without reload.                                                                                                                                                                                                                          |
