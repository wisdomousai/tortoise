# @agent-native/site

The site host plugin. It resolves the site policy against the composed declarations and refuses one below its profile floor. It enforces the policy's identity floor and hands the resolved policy to the network, audit and compliance plugins. It is composed first. It binds nothing and records nothing on its own: those are the [`network`](../network/README.md) and [`audit`](../audit/README.md) plugins, which require it.

Layer: plugins (`plugins/*`), shipped with the framework. Server only, except `plugin-manifest`.

## Primitives

- [Site policy](../../docs/primitives.md#site-policy): `sitePlugin`, `sitePluginManifest`, `openSite`, `siteServiceOf`, `SiteService`, `assertIdentity`, `portsNeeded`, `sitePolicyFor`, `policyErrors`, `siteCommand`, `siteCliCommand`, `siteUsage`, `POLICY_REJECTED_EXIT_CODE`.
- [Task package](../../docs/primitives.md#task-package): `site install <bundle>`, `site status` and `site uninstall` (`installVerb`, `installBundle`, `installStatus`, `uninstall`, `installLayout`, `InstallRecord`). They run in the bundled binary of the application being installed.
  - **Install, in order:** verify the bundle against `--trust`; admit it against the installed release and `--approval`; copy it to `opt/agent-native/<app>/releases/<version>` and verify the copy. Then render the systemd unit and nftables rules (or WinSW XML and Windows Firewall script) with the new release's own `network export`. Migrate the workspace with that release's `migrate`, and only then repoint `current`.
  - **Layout:** data lives in `var/lib/agent-native/<app>`, outside every release, so switching releases never moves it. `--prefix` stages the same tree in another directory.
  - **Applying:** only `--apply` creates the service account and loads the firewall rules and the service. It also stops the service before migrating.
- [Host plugin](../../docs/primitives.md#host-plugin): `sitePlugin` is written only against `@agent-native/host/plugin`. It provides the `identity` port and declares the ports its policy `needs`.

The [architecture](../../docs/architecture.md#plugins) explains how plugins use each other through ports and declare the ports they need. [Security and compliance](../../docs/security-and-compliance.md) is the operator's guide.

## Entrypoints

| Import                               | Runs in            | Contents                                                                                           |
| ------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------- |
| `@agent-native/site`                 | server only        | The exports listed under Primitives.                                                               |
| `@agent-native/site/*`               | server only        | One source file each. Only `plugin-manifest` is browser-safe.                                      |
| `@agent-native/site/plugin-manifest` | browser and server | `sitePluginManifest`: the `site-policy` setting.                                                   |
| `@agent-native/site/plugin`          | server only        | `sitePlugin`, for `defineApplication({ plugins })`.                                                |
| `@agent-native/site/open`            | server only        | `openSite`, and `siteServiceOf` for plugins that read the resolved policy.                         |
| `@agent-native/site/policy-file`     | server only        | `sitePolicyFor` and `policyErrors`, which offline CLI verbs of other plugins use to read a policy. |
| `@agent-native/site/cli`             | server only        | `site check`, the install verbs and `POLICY_REJECTED_EXIT_CODE`.                                   |

`identity` (`assertIdentity`) and `needs` (`portsNeeded`) are importable by path, as are `install/install`, `install/layout`, `install/native` (the OS commands), `install/windows` and `install/cli`.

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
- selecting a TLS or mTLS listener needs `ingress`;
- asking for a fail-closed or forwarded audit trail needs `eventLog`.

The host refuses a composition in which none of the composed plugins provides one of them, so a policy never looks enforced while nothing enforces it.

The service (`services.site`) holds the resolved policy and composed requirements, never credentials or file contents beyond what the policy names.

The install verbs trust only what verifies against `--trust`. The copy in the release directory is verified again before anything runs from it. A failed admission, policy check, render or migration leaves `current` on the previous release, with its data untouched. The service account name is restricted to a plain account name, because it goes into shell commands and unit files. `site status` exits 1 when the active release no longer verifies. `uninstall` keeps the workspace and the audit log unless `--purge` is given. `install/native.ts` is the plugin's one exemption from the process rule in `check:boundaries`. It runs only in these operator verbs, never inside an authority.

Gaps:

- No workforce identity adapter or certificate lifecycle exists, so `external` identity refuses to start.
- Install needs the application to compose the network plugin, which renders the service files.
- The WinSW wrapper executable is the site's to supply.
- No kiosk client mode exists yet.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/egress` (policy schema and resolution), `@agent-native/adapters/cli`, `@agent-native/runtime` (types), `@agent-native/host` (`plugin`, `plugin-manifest`, `manifest`, `components`). No external packages.

## Tests

```sh
bun test examples/project-tasks/test/hardening.test.ts examples/project-tasks/test/security.test.ts
bun test plugins/network
bun test apps/desktop/test/site-policy.test.ts
bun test plugins/site
```

The plugin is exercised through applications that compose it, because a policy only means something against a catalog with declared destinations. The project-tasks suites cover isolated defaults, profile floors, identity and mTLS. The network suite shows a connected policy refused without the network plugin. The desktop test covers the shipped site policy. `test/install.test.ts` installs signed fixture bundles into a staged prefix. Their binaries run `test/fixtures/install-cli.ts`, an application composing this plugin and the network plugin. It covers:

- a first install refused without approval;
- the rendered unit, rules and modes;
- an upgrade that migrates the workspace before switching;
- a tampered release reported by `status`;
- a tampered bundle refused while `current` stays put;
- uninstall keeping data.

With `SITE_INSTALL_NATIVE=1` (the `site-install` CI job on Ubuntu), it also runs `systemd-analyze verify` on the unit and `nft -c -f` on the rules.
