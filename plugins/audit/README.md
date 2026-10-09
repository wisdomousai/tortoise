# @agent-native/audit

The audit host plugin. It opens the hash-chained event log in the site policy's audit mode, under a writer lock, and provides it as the host's event-log port. The runtime and the network plugin's guard record into it. It forwards the log off the host when the policy names a collector. It attests the running executable, catalog and policy before the first request, and resolves commands a crash left open. `audit verify` checks a log, or a copy taken off the host, without opening a workspace.

Layer: plugins (`plugins/*`), shipped with the framework. Server only, except `plugin-manifest`.

## Primitives

- [Event log](../../docs/primitives.md#event-log): `auditPlugin`, `auditPluginManifest`, `auditCollectorComponent`, `openAudit`, `auditServiceOf`, `AuditService`, `auditCommand`, `auditCliCommand`, `auditUsage`, `AUDIT_INVALID_EXIT_CODE`.
- [Host plugin](../../docs/primitives.md#host-plugin): `auditPlugin` requires `site`. It is written only against `@agent-native/host/plugin` and reaches its collector through the composed network port.

[ADR 011](../../docs/decisions/011-plugins-by-port.md) records the split. [ADR 007](../../docs/decisions/007-declared-egress-and-audit-log.md) records the controls, and [Security and compliance](../../docs/security-and-compliance.md) is the operator's guide.

## Entrypoints

| Import                                | Runs in            | Contents                                                                          |
| ------------------------------------- | ------------------ | --------------------------------------------------------------------------------- |
| `@agent-native/audit`                 | server only        | The exports listed under Primitives.                                              |
| `@agent-native/audit/*`               | server only        | One source file each. Only `plugin-manifest` is browser-safe.                     |
| `@agent-native/audit/plugin-manifest` | browser and server | `auditPluginManifest`: the `audit-collector` destination and `audit-log` setting. |
| `@agent-native/audit/plugin`          | server only        | `auditPlugin`, for `defineApplication({ plugins })`.                              |
| `@agent-native/audit/open`            | server only        | `openAudit`, and `auditServiceOf` for plugins that read the log.                  |
| `@agent-native/audit/cli`             | server only        | `audit verify` and `AUDIT_INVALID_EXIT_CODE`.                                     |

`audit-channel` (log and forwarder), `syslog`, `attestation` and `executable-digest` are used only inside the package.

What the plugin does at each lifecycle hook:

| Hook       | Effect                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `open`     | Opens the log in the policy's audit mode, wraps it in a forwarder when `audit.forwardTo` is set, and provides it as `eventLog`. |
| `ready`    | Records `config.loaded` and `policy.loaded`, then resolves `command.accepted` events without an outcome.                        |
| `describe` | `{ log, mode }` for the `listening` record.                                                                                     |
| `close`    | Flushes the forwarder, then closes the sink and the log. The network plugin, opened earlier, is still open for the final flush. |

## Trust boundary

The `audit-log` setting (`--audit-log` / `AGENT_NATIVE_AUDIT_LOG`) is a trusted launcher input, and the plugin never reads caller input. In required audit mode, a command whose `command.accepted` append fails rolls back. That guarantee lives in the runtime; this plugin only provides the port. The forwarder's connection goes through the composed network port, so it is declared, bound and recorded like any other. Without the network plugin it is refused, and the forwarder counts the failure.

The service (`services.audit`) gives later plugins the log directory, writer head, forwarder statistics and attested digests, never credentials. It is trusted code like the plugin itself.

Gaps: removing the newest events is detectable only against an anchor or a forwarded copy. No off-host collector has been exercised.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/event-log`, `@agent-native/egress` (types), `@agent-native/adapters/cli`, `@agent-native/host` (`plugin`, `plugin-manifest`, `manifest`) and `@agent-native/site` (the policy whose audit mode it applies). No external packages.

## Tests

```sh
bun test examples/project-tasks/test/security.test.ts examples/quality-inspection/test/security.test.ts
bun run test:sandbox
```

The plugin is exercised through applications that compose it ([P13](../../docs/principles.md#p13--the-application-reaches-only-what-it-declares-and-the-site-binds-and-records-what-it-does)):

- the project-tasks suite covers attestation, auditing over every channel, fail-closed rollback and crash recovery;
- the quality-inspection suite covers `audit verify` and tamper detection;
- the sandbox test verifies the compiled binary's chain.
