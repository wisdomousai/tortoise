# @agent-native/assurance

The evidence an auditor checks, generated from the catalog and site policy and re-checked while the application runs: the security manifest and data flows, a control mapping, a CycloneDX SBOM, default-deny OS and orchestrator rules, and a posture monitor. An application composes it as the `assurance` [host plugin](../../docs/primitives.md#host-plugin), after the security plugin it reads from. Listed auditors then read posture and the audit log through ordinary, authorized and audited queries, a serving host re-checks posture on an interval, and the CLI gains `security check|export` and `audit verify|report`.

Layer: plugins (`plugins/*`), shipped with the framework. Server only, except `contracts`, `plugin-manifest`, `plugin-screens` and `components/`.

## Primitives

- [Assurance bundle](../../docs/primitives.md#assurance-bundle): `securityManifest`, `dataFlowsMarkdown`, `controls`, `cycloneDx`, `networkRules`, `exportRules`, `assessPosture`, `createPostureMonitor`, `assuranceModule`, `createAssuranceHandlers`, `assurancePlugin`, `assurancePluginManifest`, `assuranceScreens`, `assuranceCommand`, `assuranceCliCommand`.
- [Host plugin](../../docs/primitives.md#host-plugin): `assurancePlugin` requires `security` and reads its service; it is written only against `@agent-native/host/plugin`.
- [UI registry](../../docs/primitives.md#ui-registry): `security-screen`, the plugin's own shadcn registry in [`registry.json`](registry.json).
- [Execution host](../../docs/primitives.md#execution-host): `exportRules` describes the OS sandbox and firewall rules for the service.

[Security and assurance](../../docs/security-and-assurance.md) describes the bundle. Generated output for each application is under `docs/reference/<id>/`, and the control mapping is [`docs/reference/controls.md`](../../docs/reference/controls.md).

## Entrypoints

| Import                                    | Runs in            | Contents                                                                                                        |
| ----------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `@agent-native/assurance`                 | server only        | Manifest, controls, SBOM, rules, exporters, posture and monitor.                                                |
| `@agent-native/assurance/*`               | server only        | One source file, listed below. Only `contracts`, `plugin-manifest` and `plugin-screens` are browser-safe.       |
| `@agent-native/assurance/contracts`       | browser and server | `assuranceModule`, `assuranceOperations` and their schemas. Queries only.                                       |
| `@agent-native/assurance/server`          | server only        | `createAssuranceHandlers`, `createAssuranceState`, `assurancePolicy`.                                           |
| `@agent-native/assurance/plugin-manifest` | browser and server | `assurancePluginManifest`: the `assurance` module, for `defineManifest({ plugins })`.                           |
| `@agent-native/assurance/plugin`          | server only        | `assurancePlugin`: the `assurance` slice, handlers, policy over `audit`, posture monitor and CLI verbs.         |
| `@agent-native/assurance/plugin-screens`  | browser            | `assuranceScreens`: the Security screen at `/security`, its navigation item and the `assurance.` prefix.        |
| `@agent-native/assurance/cli`             | server only        | `assuranceCommand`, `assuranceCliCommand` (the plugin's command) and the exit codes.                            |
| `@agent-native/assurance/exporters`       | server only        | `exportRules` for `json`, `nftables`, `windows-firewall`, `k8s-networkpolicy`, `k8s-pod`, `compose`, `systemd`. |

`manifest`, `controls`, `sbom`, `rules`, `posture` and `monitor` are also importable by path; the root export covers them.

`exporters/` has one file per format plus the shared header, YAML and service defaults. `sbom/` holds the lockfile parser and the dependency graph. `audit-events` pages the audit log for the monitor. These are imported only from inside the package.

`src/components/security-screen.tsx` is the Security screen: read-only posture, destinations, recent denials and chain status from the `assurance.*` queries, polling because the log has no change feed. It is built from the starter's stock primitives (`@/components/ui/*`) and the frame's `@/lib/session`. `bun run build:registry:assurance` publishes it as the `agent-native-assurance` registry (`dist/registry/assurance`), so a starter can `shadcn add` and own it.

## Trust boundary

The assurance capabilities are queries only: nothing here changes configuration, and the log stays append-only. Each call needs `read` on `Audit` from the plugin's own policy over its `assurance` slice. The workspace owner is the only auditor at creation (`createAssuranceState`), and each call is itself audited. The application's policy never decides these operations, and this policy never sees application state. A host without an audit log reports unavailable, not empty.

Generation is deterministic and drift-checked by `bun run check:generated`. Rule exports are default-deny, carry the policy digest and list what they could not enforce (hostname-only bindings, for example). Control mappings are indicative and are not a certification; control IDs (`AN-<area>-<n>`) are stable and never renumbered.

Gaps: exports are compared as text, not loaded into a firewall or cluster.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/egress`, `@agent-native/event-log`, `@agent-native/adapters/cli`, `@agent-native/host` (`plugin`, `plugin-manifest`, `manifest`, `components`), `@agent-native/security/open` (the service it reads) and `@agent-native/frame/plugin-screens`; the screen uses the starter's `@/components/ui` primitives and the frame's `@/lib/session`. External: `zod`, `lucide-react`, `react`, `@tanstack/react-query`. Reads `bun.lock` for the SBOM.

## Tests

```sh
bun test plugins/assurance
UPDATE_GOLDEN=1 bun test plugins/assurance   # after an intended exporter change; review the diff
```

`test/assurance.test.ts` covers [P13](../../docs/principles.md#p13--the-application-reaches-only-what-it-declares-and-the-site-binds-and-records-what-it-does) and [P10](../../docs/principles.md#p10--a-claim-is-only-as-strong-as-its-evidence): rule exports against golden files in `test/golden`, manifest ownership, a deterministic SBOM, controls whose evidence exists, posture findings, `posture.checked`, audit-event paging and behavioral scenarios through the direct driver. The screen's bindings are checked by each example's `test/ui-bindings.test.ts`, and `examples/quality-inspection/e2e/security.pw.ts` drives it in Chromium.
