# @agent-native/site

The site host plugin. It resolves the site policy against the composed declarations and refuses one below its profile floor. It enforces the policy's identity floor and hands the resolved policy to the network, audit and compliance plugins. It is composed first. It binds nothing and records nothing on its own: those are the [`network`](../network/README.md) and [`audit`](../audit/README.md) plugins, which require it.

Layer: plugins (`plugins/*`), shipped with the framework. Server only, except `plugin-manifest`.

## Primitives

- [Site policy](../../docs/primitives.md#site-policy): `sitePlugin`, `sitePluginManifest`, `openSite`, `siteServiceOf`, `SiteService`, `assertIdentity`, `portsNeeded`, `sitePolicyFor`, `policyErrors`, `siteCommand`, `siteCliCommand`, `siteUsage`, `POLICY_REJECTED_EXIT_CODE`.
- [Host plugin](../../docs/primitives.md#host-plugin): `sitePlugin` is written only against `@agent-native/host/plugin`. It provides the `identity` port and declares the ports its policy `needs`.

[ADR 011](../../docs/decisions/011-plugins-compose-through-ports.md) records how plugins use each other through ports and declare the ports they need. [Security and compliance](../../docs/security-and-compliance.md) is the operator's guide.

## Entrypoints

| Import                               | Runs in            | Contents                                                                                           |
| ------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------- |
| `@agent-native/site`                 | server only        | The exports listed under Primitives.                                                               |
| `@agent-native/site/*`               | server only        | One source file each. Only `plugin-manifest` is browser-safe.                                      |
| `@agent-native/site/plugin-manifest` | browser and server | `sitePluginManifest`: the `site-policy` setting.                                                   |
| `@agent-native/site/plugin`          | server only        | `sitePlugin`, for `defineApplication({ plugins })`.                                                |
| `@agent-native/site/open`            | server only        | `openSite`, and `siteServiceOf` for plugins that read the resolved policy.                         |
| `@agent-native/site/policy-file`     | server only        | `sitePolicyFor` and `policyErrors`, which offline CLI verbs of other plugins use to read a policy. |
| `@agent-native/site/cli`             | server only        | `site check` and `POLICY_REJECTED_EXIT_CODE`.                                                      |

`identity` (`assertIdentity`) and `needs` (`portsNeeded`) are importable by path.

What the plugin does at each lifecycle hook:

| Hook       | Effect                                                                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open`     | Loads the policy, or isolates without one, and refuses one below its floor. Provides `identity`, exposes `{ policy, requirements }` and declares what it needs. |
| `describe` | `{ profile, policyDigest }` for the `listening` record.                                                                                                         |

## Trust boundary

The `site-policy` setting (`--site-policy` / `AGENT_NATIVE_SITE_POLICY`) is a trusted launcher input, and the plugin never reads caller input. Without a policy the application is isolated and needs nothing from other plugins. A policy below its profile floor refuses startup. It never falls back to plain transport or to the local owner.

`identity.admit` admits the trusted local owner only when the policy's identity is `local-owner`. `grant-file` admits only a delegated grant, within `grants.maxTtlSeconds` when that is set, and `external` refuses.

A supplied policy declares the ports it depends on (`portsNeeded`):

- binding destinations (connected mode) needs `network`;
- selecting mTLS needs `ingress`;
- asking for a fail-closed or forwarded audit trail needs `eventLog`.

The host refuses a composition in which none of the composed plugins provides one of them, so a policy never looks enforced while nothing enforces it.

The service (`services.site`) holds the resolved policy and composed requirements, never credentials or file contents beyond what the policy names.

Gaps: no workforce identity adapter or certificate lifecycle exists, so `external` identity refuses to start.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/egress` (policy schema and resolution), `@agent-native/adapters/cli`, `@agent-native/runtime` (types), `@agent-native/host` (`plugin`, `plugin-manifest`, `manifest`, `components`). No external packages.

## Tests

```sh
bun test examples/project-tasks/test/hardening.test.ts examples/project-tasks/test/security.test.ts
bun test plugins/network
bun test apps/desktop/test/site-policy.test.ts
```

The plugin is exercised through applications that compose it, because a policy only means something against a catalog with declared destinations ([P13](../../docs/principles.md#p13--the-application-reaches-only-what-it-declares-and-the-site-binds-and-records-what-it-does)). The project-tasks suites cover isolated defaults, profile floors, identity and mTLS. The network suite shows a connected policy refused without the network plugin. The desktop test covers the shipped site policy.
