# @agent-native/security

The security host plugin. It turns the kernel's deny-by-default ports into one site's deployment. It reads the site policy, guards egress and the child proxy, writes the fail-closed audit log and forwards it, attests the executable, catalog and policy at startup, recovers commands a crash left open, and enforces the identity and ingress floors. An application gets all of this by listing the plugin. The host knows none of it.

Layer: plugins (`plugins/*`), shipped with the framework. Server only, except `plugin-manifest`.

## Primitives

- [Host plugin](../../docs/primitives.md#host-plugin): `securityPlugin` is a plugin written only against `@agent-native/host/plugin`, with no private hooks.
- [Site policy](../../docs/primitives.md#site-policy): `securityPlugin`, `securityPluginManifest`, `auditCollectorComponent`, `openSecurity`, `securityServiceOf`, `SecurityService`, `assertIdentity`, `mtlsIngress`.

[ADR 010](../../docs/decisions/010-host-plugins.md) records why these controls are a plugin. [ADR 007](../../docs/decisions/007-declared-egress-and-audit-log.md) records the controls themselves, and [security-and-assurance.md](../../docs/security-and-assurance.md) is the operator's guide.

## Entrypoints

| Import                                   | Runs in            | Contents                                                                                                    |
| ---------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `@agent-native/security`                 | server only        | The exports listed under Primitives.                                                                        |
| `@agent-native/security/*`               | server only        | One source file, listed below. Only `plugin-manifest` is browser-safe.                                      |
| `@agent-native/security/plugin-manifest` | browser and server | `securityPluginManifest`: the `audit-collector` destination and the `site-policy` and `audit-log` settings. |
| `@agent-native/security/plugin`          | server only        | `securityPlugin`, for `defineApplication({ plugins })`.                                                     |
| `@agent-native/security/open`            | server only        | `openSecurity`, the plugin's `open`, and `securityServiceOf` for plugins that read its service.             |

`identity` (`assertIdentity`) and `ingress` (`mtlsIngress`) are importable by path. `audit-channel` (log, forwarder, egress guard and child proxy), `syslog`, `attestation` and `executable-digest` are used only inside the package.

What the plugin does at each lifecycle hook:

| Hook       | Effect                                                                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open`     | Loads the policy, or isolates without one, and refuses one below its floor. Opens the log and forwarder, plus the child proxy when serving. Provides `network`, `ingress` (mTLS only), `identity` and `eventLog`. |
| `ready`    | Records the attestation events and resolves `command.accepted` events without an outcome.                                                                                                                         |
| `describe` | `{ profile, network, auditLog }` for the `listening` record.                                                                                                                                                      |
| `close`    | Stops the proxy, flushes the forwarder, then closes the sink and the log.                                                                                                                                         |

## Trust boundary

Settings are trusted launcher inputs: `--site-policy` / `AGENT_NATIVE_SITE_POLICY` and `--audit-log` / `AGENT_NATIVE_AUDIT_LOG`. The plugin never reads caller input. Without a policy it binds nothing, and every destination is refused with `UNAVAILABLE`. A policy below its profile floor refuses startup. It never falls back to plain transport or to the local owner. `identity.admit` admits the trusted local owner only when the policy's identity is `local-owner`. `grant-file` admits only a delegated grant, within `grants.maxTtlSeconds` when that is set, and `external` refuses. In required audit mode a command whose `command.accepted` append fails rolls back. That guarantee lives in the runtime; this plugin only provides the port.

The service it exposes (`services.security`) is read by later plugins such as assurance, and it is trusted code like the plugin itself. It carries the policy, log head and forwarder statistics, never credentials. `childEnvironment` points a declared process at the loopback proxy limited to its declared destinations. An embedded authority does not start the proxy, so children are refused there.

Gaps: the guard is in-process. Real containment needs the exported OS rules. No workforce identity adapter or certificate lifecycle exists.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/egress`, `@agent-native/event-log`, `@agent-native/host/plugin` and `@agent-native/host/plugin-manifest`. No external packages.

## Tests

```sh
bun test examples/project-tasks/test/security.test.ts examples/project-tasks/test/hardening.test.ts examples/project-tasks/test/security-conformance.test.ts
bun test apps/desktop/test/site-policy.test.ts
bun test plugins/webhook
```

The plugin is exercised through applications that compose it, because a policy only means something against a catalog with declared destinations ([P13](../../docs/principles.md#p13--the-application-reaches-only-what-it-declares-and-the-site-binds-and-records-what-it-does)). The project-tasks suites cover isolated defaults, bound and refused destinations, profile floors, mTLS, attestation, recovery and audit verification. The desktop test covers the shipped site policy. The webhook suite shows a third-party plugin refused by this plugin's guard for an unbound destination. `bun run test:isolated` and `bun run test:sandbox` check that no path escapes it.
