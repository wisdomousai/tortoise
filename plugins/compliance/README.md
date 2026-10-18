# @agent-native/compliance

This [host plugin](../../docs/glossary.md#host-plugin) produces the [compliance bundle](../../docs/glossary.md#compliance-bundle): the security manifest and data flows, a control mapping, a CycloneDX SBOM and a posture monitor. They are generated from the [catalog](../../docs/glossary.md#catalog) and the [deployment policy](../../docs/glossary.md#deployment-policy), and a serving host re-checks posture on an interval. Listed auditors read posture and the [audit log](../../docs/glossary.md#audit-log) through ordinary queries, and the CLI gains `compliance report`.

## Layer

Plugin layer, shipped with the framework. An application composes it as `compliance`, after the site and audit plugins it reads from. Server only, except `contracts`, `plugin-manifest`, `plugin-screens` and `components/`. It trusts the services of the site and audit plugins, and changes nothing it reads.

## Primitives

- [Compliance bundle](../../docs/primitives.md#compliance-bundle): `securityManifest`, `dataFlowsMarkdown`, `osManifest`, `osTables`, `controls`, `controlsMarkdown`, `cycloneDx`, `assessPosture`, `createPostureMonitor`, `complianceModule`, `createComplianceHandlers`, `compliancePlugin`, `compliancePluginManifest`, `complianceScreens`, `complianceCommand`, `complianceCliCommand`.
- [OS handler](../../docs/primitives.md#os-handler) and [OS action](../../docs/primitives.md#os-action): the manifest's `os` section lists handlers as local ingress and actions with their data classes. The data-flow document adds a table for each when any are declared.
- [Host plugin](../../docs/primitives.md#host-plugin): `compliancePlugin` requires `site` and `audit` and reads their services. It is written only against `@agent-native/host/plugin`.
- [UI registry](../../docs/primitives.md#ui-registry): `compliance-screen`, the plugin's own shadcn registry in [`registry.json`](registry.json).

[Security and compliance](../../docs/security-and-compliance.md#compliance-bundle) describes the bundle. `bun run generate` writes each application's output to `dist/reference/<id>/` and the control mapping to `dist/reference/controls.md`. None of it is committed. The [network plugin](../network/README.md) exports firewall and orchestrator rules.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/compliance` | server only | Manifest, controls, SBOM, posture and monitor. |
| `@agent-native/compliance/*` | server only | One source file each. Only `contracts`, `plugin-manifest` and `plugin-screens` are browser-safe. |
| `@agent-native/compliance/contracts` | browser and server | `complianceModule`, `complianceOperations` and their schemas, all queries. |
| `@agent-native/compliance/server` | server only | `createComplianceHandlers`, `createComplianceState`, `compliancePolicy`. |
| `@agent-native/compliance/plugin-manifest` | browser and server | `compliancePluginManifest`: the `compliance` module, for `defineManifest({ plugins })`. |
| `@agent-native/compliance/plugin` | server only | `compliancePlugin`: the slice, handlers, policy over `audit`, posture monitor and CLI verb. |
| `@agent-native/compliance/plugin-screens` | browser | `complianceScreens`: the screen at `/compliance`, its navigation item and the `compliance.` prefix. |
| `@agent-native/compliance/cli` | server only | `complianceCommand` and `complianceCliCommand` (`compliance report`). |

`manifest`, `controls`, `sbom`, `posture` and `monitor` are also importable by path, and the root export covers them.

### Compliance screen

`src/components/compliance-screen.tsx` is the Compliance [screen](../../docs/glossary.md#screen). It shows read-only posture, destinations, recent denials and chain status from the `compliance.*` queries. It polls, because the audit log has no change feed. It is built from the starter's stock primitives (`@/components/ui/*`) and the frame's `@/lib/session`.

`bun run build:registry:compliance` publishes the screen as the `agent-native-compliance` registry in `dist/registry/compliance`. A starter can then `shadcn add` it and own it.

## Trust boundary

The compliance [capabilities](../../docs/glossary.md#capability) are queries only. Nothing here changes configuration, and the log stays append-only.

Each call needs `read` on `Audit` from the plugin's own [policy](../../docs/glossary.md#policy) over its `compliance` slice. At creation, the workspace owner is the only auditor (`createComplianceState`). Each call is itself audited. The application's policy never decides these capabilities, and this policy never sees application state. A host without an audit log reports unavailable instead of empty.

Generation is deterministic. Control mappings are indicative and are not a certification. Control IDs (`AN-<area>-<n>`) are stable and never renumbered.

## Dependencies

Framework:

- `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/site/policy` (types) and `@agent-native/event-log`;
- `@agent-native/adapters/cli`;
- `@agent-native/host` (`plugin`, `plugin-manifest`, `manifest`, `components`) and `@agent-native/frame/plugin-screens`;
- `@agent-native/site` for the policy, and `@agent-native/audit` for the log and exit code.

External: `zod`, `lucide-react`, `react` and `@tanstack/react-query`. The screen also uses the starter's `@/components/ui` primitives and the frame's `@/lib/session`.

`scripts/bundle.ts` passes `bun.lock` to `cycloneDx` when it builds a site bundle. Nothing commits an SBOM.

## Tests

```sh
bun test plugins/compliance
```

- `test/compliance.test.ts` covers:
  - manifest ownership, the OS handler and action section, and a deterministic SBOM;
  - controls whose evidence exists;
  - posture findings and `posture.checked`, including certificate expiry judged at each check;
  - audit-event paging;
  - [behavioral scenarios](../../docs/glossary.md#behavioral-scenario) through the direct driver.
- Each example's `test/ui-bindings.test.ts` checks the screen's bindings.
- `examples/quality-inspection/e2e/compliance.pw.ts` drives the screen in Chromium.

## Skills

- [deploy-to-site](../site/skills/deploy-to-site/SKILL.md): deployment policy, signed bundles and install.
