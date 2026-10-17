# @agent-native/compliance

The evidence an auditor checks, generated from the catalog and site policy and re-checked while the application runs. It contains the security manifest and data flows, a control mapping, a CycloneDX SBOM and a posture monitor. An application composes it as the `compliance` [host plugin](../../docs/primitives.md#host-plugin), after the site and audit plugins it reads from. Listed auditors then read posture and the audit log through ordinary queries, which are authorized and audited like any other operation. A serving host re-checks posture on an interval, and the CLI gains `compliance report`.

Layer: plugins (`plugins/*`), shipped with the framework. Server only, except `contracts`, `plugin-manifest`, `plugin-screens` and `components/`.

## Primitives

- [Compliance bundle](../../docs/primitives.md#compliance-bundle): `securityManifest`, `dataFlowsMarkdown`, `osManifest`, `osTables`, `controls`, `controlsMarkdown`, `cycloneDx`, `assessPosture`, `createPostureMonitor`, `complianceModule`, `createComplianceHandlers`, `compliancePlugin`, `compliancePluginManifest`, `complianceScreens`, `complianceCommand`, `complianceCliCommand`.
- [OS handler](../../docs/primitives.md#os-handler) and [OS action](../../docs/primitives.md#os-action): the manifest's `os` section lists handlers as local ingress and actions with their data classes, and the data-flow document adds a table for each when any are declared.
- [Host plugin](../../docs/primitives.md#host-plugin): `compliancePlugin` requires `site` and `audit` and reads their services. It is written only against `@agent-native/host/plugin`.
- [UI registry](../../docs/primitives.md#ui-registry): `compliance-screen`, the plugin's own shadcn registry in [`registry.json`](registry.json).

[Security and compliance](../../docs/security-and-compliance.md) describes the bundle. `bun run generate` writes each application's output to `dist/reference/<id>/` and the control mapping to `dist/reference/controls.md`; none of it is committed. Firewall and orchestrator rule exports belong to the [network plugin](../network/README.md).

## Entrypoints

| Import                                     | Runs in            | Contents                                                                                                       |
| ------------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `@agent-native/compliance`                 | server only        | Manifest, controls, SBOM, posture and monitor.                                                                 |
| `@agent-native/compliance/*`               | server only        | One source file, listed below. Only `contracts`, `plugin-manifest` and `plugin-screens` are browser-safe.      |
| `@agent-native/compliance/contracts`       | browser and server | `complianceModule`, `complianceOperations` and their schemas. Queries only.                                    |
| `@agent-native/compliance/server`          | server only        | `createComplianceHandlers`, `createComplianceState`, `compliancePolicy`.                                       |
| `@agent-native/compliance/plugin-manifest` | browser and server | `compliancePluginManifest`: the `compliance` module, for `defineManifest({ plugins })`.                        |
| `@agent-native/compliance/plugin`          | server only        | `compliancePlugin`: the `compliance` slice, handlers, policy over `audit`, posture monitor and CLI verb.       |
| `@agent-native/compliance/plugin-screens`  | browser            | `complianceScreens`: the Compliance screen at `/compliance`, its navigation item and the `compliance.` prefix. |
| `@agent-native/compliance/cli`             | server only        | `complianceCommand` and `complianceCliCommand` (`compliance report`).                                          |

`manifest`, `controls`, `sbom`, `posture` and `monitor` are also importable by path; the root export covers them.

`sbom/` holds the lockfile parser and the dependency graph, and `audit-events` pages the audit log for the monitor. Both are imported only from inside the package.

`src/components/compliance-screen.tsx` is the Compliance screen. It shows read-only posture, destinations, recent denials and chain status from the `compliance.*` queries, and it polls because the log has no change feed. It is built from the starter's stock primitives (`@/components/ui/*`) and the frame's `@/lib/session`. `bun run build:registry:compliance` publishes it as the `agent-native-compliance` registry (`dist/registry/compliance`), so a starter can `shadcn add` and own it.

## Trust boundary

The compliance capabilities are queries only. Nothing here changes configuration, and the log stays append-only. Each call needs `read` on `Audit` from the plugin's own policy over its `compliance` slice. The workspace owner is the only auditor at creation (`createComplianceState`), and each call is itself audited. The application's policy never decides these operations, and this policy never sees application state. A host without an audit log reports unavailable, not empty.

Generation is deterministic. Control mappings are indicative and are not a certification. Control IDs (`AN-<area>-<n>`) are stable and never renumbered.

## Dependencies

Framework:

- `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/egress` and `@agent-native/event-log`;
- `@agent-native/adapters/cli`;
- `@agent-native/host` (`plugin`, `plugin-manifest`, `manifest`, `components`) and `@agent-native/frame/plugin-screens`;
- `@agent-native/site` (the policy) and `@agent-native/audit` (the log and exit code).

The screen uses the starter's `@/components/ui` primitives and the frame's `@/lib/session`. External: `zod`, `lucide-react`, `react`, `@tanstack/react-query`. `scripts/bundle.ts` passes `bun.lock` to `cycloneDx` when it builds a site bundle; nothing commits an SBOM.

## Tests

```sh
bun test plugins/compliance
```

`test/compliance.test.ts`:

- manifest ownership, the OS handler and action section, and a deterministic SBOM;
- controls whose evidence exists;
- posture findings and `posture.checked`;
- audit-event paging;
- behavioral scenarios through the direct driver.

Each example's `test/ui-bindings.test.ts` checks the screen's bindings, and `examples/quality-inspection/e2e/compliance.pw.ts` drives the screen in Chromium.
