# @agent-native/assurance

The evidence an auditor checks, generated from the catalog and site policy and re-checked while the application runs: the security manifest and data flows, a control mapping, a CycloneDX SBOM, default-deny OS and orchestrator rules, and a posture monitor. Every application composes its `assurance` module, so listed auditors read posture and the audit log through ordinary, authorized and audited queries.

Layer: framework (`packages/*`). Server only, except the capability module.

## Primitives

- [Assurance bundle](../../docs/primitives.md#assurance-bundle): `securityManifest`, `dataFlowsMarkdown`, `controls`, `cycloneDx`, `networkRules`, `exportRules`, `assessPosture`, `createPostureMonitor`, `assuranceModule`, `createAssuranceHandlers`.
- [Execution host](../../docs/primitives.md#execution-host): `exportRules` describes the OS sandbox and firewall rules for the service.

[Security and assurance](../../docs/security-and-assurance.md) describes the bundle. Generated output for each application is under `docs/reference/<id>/`, and the control mapping is [`docs/reference/controls.md`](../../docs/reference/controls.md).

## Entrypoints

| Import                              | Runs in            | Contents                                                                                                        |
| ----------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `@agent-native/assurance`           | server only        | Manifest, controls, SBOM, rules, exporters, posture and monitor.                                                |
| `@agent-native/assurance/*`         | server only        | One source file, listed below. Only `contracts` is browser-safe.                                                |
| `@agent-native/assurance/contracts` | browser and server | `assuranceModule`, `assuranceOperations` and their schemas. Queries only.                                       |
| `@agent-native/assurance/server`    | server only        | `createAssuranceHandlers`, `createAssuranceState`, `assurancePolicy`, `assuranceAuthorizationRoute`.            |
| `@agent-native/assurance/exporters` | server only        | `exportRules` for `json`, `nftables`, `windows-firewall`, `k8s-networkpolicy`, `k8s-pod`, `compose`, `systemd`. |

`manifest`, `controls`, `sbom`, `rules`, `posture` and `monitor` are also importable by path; the root export covers them.

## Trust boundary

The assurance capabilities are queries only: nothing here changes configuration, and the log stays append-only. Each call needs `read` on `Audit`, which the composing application grants in its own state (`createAssuranceState`), and each call is itself audited. A host without an audit log reports unavailable, not empty.

Generation is deterministic and drift-checked by `bun run check:generated`. Rule exports are default-deny, carry the policy digest and list what they could not enforce (hostname-only bindings, for example). Control mappings are indicative and are not a certification; control IDs (`AN-<area>-<n>`) are stable and never renumbered.

Gaps: exports are compared as text, not loaded into a firewall or cluster.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/egress`, `@agent-native/event-log`. External: `zod`. Reads `bun.lock` for the SBOM.

## Tests

```sh
bun test packages/assurance
UPDATE_GOLDEN=1 bun test packages/assurance   # after an intended exporter change; review the diff
```

`test/assurance.test.ts` covers [P13](../../docs/principles.md#p13--the-application-reaches-only-what-it-declares-and-the-site-binds-and-records-what-it-does) and [P10](../../docs/principles.md#p10--a-claim-is-only-as-strong-as-its-evidence): rule exports against golden files in `test/golden`, manifest ownership, a deterministic SBOM, controls whose evidence exists, posture findings, `posture.checked`, audit-event paging and behavioral scenarios through the direct driver.
