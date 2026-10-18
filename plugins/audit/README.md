# @agent-native/audit

This [host plugin](../../docs/glossary.md#host-plugin) keeps the host's [audit log](../../docs/glossary.md#audit-log). It opens the hash-chained log in the [deployment policy](../../docs/glossary.md#deployment-policy)'s audit mode, forwards it off the host when the policy names a collector, and attests what runs before the first request. `audit verify` checks a log, or a copy taken off the host, without opening a [workspace](../../docs/glossary.md#workspace).

## Layer

Plugin layer, shipped with the framework. Server only, except `plugin-manifest`. It trusts the deployment policy and the `audit-log` launcher setting, and never reads [caller](../../docs/glossary.md#caller) input.

## Primitives

- [Audit log](../../docs/primitives.md#audit-log): `auditPlugin`, `auditPluginManifest`, `auditCollectorComponent`, `openAudit`, `auditServiceOf`, `AuditService`, `auditCommand`, `auditCliCommand`, `auditUsage`, `AUDIT_INVALID_EXIT_CODE`.
- [Host plugin](../../docs/primitives.md#host-plugin): `auditPlugin` requires `site`. It is written only against `@agent-native/host/plugin` and reaches its collector through the composed network port.

See [Architecture](../../docs/architecture.md#host-plugins) and [Security and compliance](../../docs/security-and-compliance.md#audit-log).

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/audit` | server only | The exports listed under Primitives. |
| `@agent-native/audit/*` | server only | One source file each. Only `plugin-manifest` is browser-safe. |
| `@agent-native/audit/plugin-manifest` | browser and server | `auditPluginManifest`: the `audit-collector` destination and the `audit-log` setting. |
| `@agent-native/audit/plugin` | server only | `auditPlugin`, for `defineApplication({ plugins })`. |
| `@agent-native/audit/open` | server only | `openAudit`, and `auditServiceOf` for plugins that read the log. |
| `@agent-native/audit/cli` | server only | `audit verify` and `AUDIT_INVALID_EXIT_CODE`. |

Only the package itself imports `audit-channel` (the log and forwarder), `syslog`, `attestation` and `executable-digest`.

### Lifecycle hooks

| Hook | Effect |
| --- | --- |
| `open` | Opens the log under its writer lock in the policy's audit mode, and provides it as `eventLog`. |
| `ready` | Records `config.loaded` and `policy.loaded`, then resolves `command.accepted` events without an outcome. |
| `describe` | Returns `{ log, mode }` for the `listening` record. |
| `close` | Flushes the forwarder, then closes the sink and the log. |

When `audit.forwardTo` is set, `open` wraps the log in a forwarder. The runtime and the network plugin's guard record into the port. The network plugin opened earlier, so it is still open for the final flush.

## Trust boundary

The `audit-log` setting (`--audit-log` or `AGENT_NATIVE_AUDIT_LOG`) is a trusted launcher input. In required audit mode, a command whose `command.accepted` append fails rolls back. The runtime makes that guarantee; this plugin only provides the port.

The forwarder connects through the composed network port, so its connection is declared, bound and recorded like any other. Without the network plugin the connection is refused, and the forwarder counts the failure.

The [plugin service](../../docs/glossary.md#plugin-service) `services.audit` gives later plugins the log directory, the writer head, forwarder statistics and the attested digests. It carries no credentials. It is trusted code like the plugin.

Limits:

- removing the newest events is detectable only against an anchor or a forwarded copy;
- no off-host collector has been exercised.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/event-log`, `@agent-native/adapters/cli`, `@agent-native/host` (`plugin`, `plugin-manifest`, `manifest`) and `@agent-native/site`, whose policy sets the audit mode. No external packages.

## Tests

```sh
bun test examples/project-tasks/test/security.test.ts examples/quality-inspection/test/security.test.ts
bun run test:sandbox
```

The package has no tests of its own. Applications that compose it exercise it:

- `examples/project-tasks/test/security.test.ts` covers attestation, audit records over HTTP and the embedded instance, the writer lock and crash recovery;
- `examples/quality-inspection/test/security.test.ts` covers `audit verify` and tamper detection;
- `examples/quality-inspection/test/sandbox.test.ts`, run by `test:sandbox`, verifies the compiled binary's chain.

`packages/runtime/test/audit.test.ts` covers the fail-closed rollback in required mode.

## Skills

- [deploy-to-site](../site/skills/deploy-to-site/SKILL.md): deployment policy, signed bundles and install.
