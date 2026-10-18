# @agent-native/network

The network host plugin turns the [deployment policy](../../docs/glossary.md#deployment-policy)'s bindings into the host's only path off the machine. It provides the [egress guard](../../docs/glossary.md#egress-guard) as the network port, and starts the loopback proxy for declared child processes in a serving host. When the policy selects it, the plugin provides the mutual TLS listener as the ingress port. Its `network export` renders the same bindings as default-deny OS and orchestrator rules, for the paths the in-process guard cannot see.

## Layer

Plugins (`plugins/*`), shipped with the framework. Server only, except `plugin-manifest`.

## Primitives

- [Egress guard](../../docs/primitives.md#egress-guard): `networkPlugin`, `networkPluginManifest`, `openNetwork`, `networkServiceOf`, `NetworkService` and `policyIngress`. The guard itself is `createEgress`, `Egress`, `EgressOptions`, `DestinationClient`, `EgressDenied`, `DenialReason` and `HostLookup` in `guard`, with `startEgressProxy` and `EgressProxy` in `proxy`.
- [Execution host](../../docs/primitives.md#execution-host): `networkRules`, `exportRules`, `exportFormats`, `networkCommand`, `networkCliCommand` and `networkUsage`.
- [Host plugin](../../docs/primitives.md#host-plugin): `networkPlugin` requires `site`. It is written only against `@agent-native/host/plugin`, and reads the [audit log](../../docs/glossary.md#audit-log) port through the composed ports.

The [architecture](../../docs/architecture.md#host-plugins) explains why network and audit reach each other only through ports. [Security and compliance](../../docs/security-and-compliance.md#egress) describes the controls for site operators.

## Entrypoints

| Import                                  | Runs in            | Contents                                                                                                        |
| --------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `@agent-native/network`                 | server only        | The exports listed under Primitives, except those of `guard` and `proxy`.                                       |
| `@agent-native/network/*`               | server only        | One source file each. Only `plugin-manifest` is browser-safe.                                                   |
| `@agent-native/network/plugin-manifest` | browser and server | `networkPluginManifest`. It declares nothing; it binds what others declare.                                     |
| `@agent-native/network/plugin`          | server only        | `networkPlugin`, for `defineApplication({ plugins })`.                                                          |
| `@agent-native/network/open`            | server only        | `openNetwork`, and `networkServiceOf` for code that needs the guard itself.                                     |
| `@agent-native/network/guard`           | server only        | `createEgress` and `EgressDenied`: destination-scoped fetch and sockets over the resolved bindings.             |
| `@agent-native/network/proxy`           | server only        | `startEgressProxy`, the loopback CONNECT proxy for declared child processes.                                    |
| `@agent-native/network/exporters`       | server only        | `exportRules` for `json`, `nftables`, `windows-firewall`, `k8s-networkpolicy`, `k8s-pod`, `compose`, `systemd`. |
| `@agent-native/network/cli`             | server only        | `network export`.                                                                                               |

`rules` holds `networkRules` and `ingress` holds `policyIngress`, and both are importable by path. `guard/` holds:

- the denial type;
- the shared kernel: audit, binding lookup, and address and TLS checks;
- the destination client with its redirect loop;
- process and multi-origin routing.

`exporters/` has one file per format, plus the shared header, YAML and service defaults.

What the plugin does at each lifecycle hook:

| Hook       | Effect                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `open`     | Builds the guard over the deployment policy, starts the child proxy when serving, and provides `network` and, under TLS or mTLS, `ingress`. |
| `describe` | `{ mode, ingress }` for the `listening` record.                                                                                       |
| `close`    | Stops the proxy. Plugins opened later, such as `audit`, have closed by then, so a final forwarder flush still has the guard.          |

## Trust boundary

A destination-scoped client allows only the bound scheme, host and port. It also:

- rechecks every redirect hop;
- checks DNS answers against the bound networks before connecting;
- applies CA bundles and certificate pins;
- caps response size and time.

Provider SDKs get a fetch routed by origin, and TCP transports get a scoped socket. Declared children get the loopback CONNECT proxy, which admits only their declared [destinations](../../docs/glossary.md#destination). The proxy identifies each child by a per-process credential. A refusal is an `UNAVAILABLE` error with a stable `DenialReason`.

The plugin reads the site plugin's resolved policy. It never reads caller input or settings of its own. The guard records each decision into the composed audit log port. It reads that port on each call, because the plugin that provides it, normally `audit`, opens later.

Without an audit log provider, decisions go unrecorded and never block. With one in fail-closed mode, a connection that cannot be recorded is refused. `childEnvironment` points a declared process at the loopback proxy, which is limited to that process's declared destinations. An embedded instance does not start the proxy, so children are refused there.

Rule exports are default-deny and carry the policy digest. They list each bound destination they could not enforce by address, instead of widening it. Like startup, they refuse a policy with error findings.

Gaps: the guard is in-process. Real containment needs the exported rules applied. The tests compare the exports as text and do not load them into a firewall or cluster.

## Dependencies

- Framework:
  - `@agent-native/contracts` and `@agent-native/adapters/cli`;
  - `@agent-native/host`: `plugin`, `plugin-manifest`, `manifest` and `components`;
  - `@agent-native/site`: the policy it binds and its address helpers.
- External: none.

## Tests

```sh
bun test plugins/network
UPDATE_GOLDEN=1 bun test plugins/network   # after an intended exporter change; review the diff
bun test plugins/webhook examples/project-tasks/test/security.test.ts examples/project-tasks/test/hardening.test.ts
```

- `test/guard.test.ts` runs the guard against a loopback server. It covers origin, redirect and address checks, audited decisions, fail-closed recording, response caps, and the child proxy admitting only declared destinations.
- `test/network.test.ts` covers rule exports against golden files in `test/golden`, the guard recording into an audit log composed after it, and a connected policy refused without this plugin.

The webhook suite shows a third-party plugin refused by the guard for an unbound destination. The project-tasks suites cover bound and refused provider destinations, the child proxy and mTLS. `bun run test:isolated` and `bun run test:sandbox` check that no path escapes the guard.

## Skills

- [deploy-to-site](../site/skills/deploy-to-site/SKILL.md): deployment policy, signed bundles and install.
