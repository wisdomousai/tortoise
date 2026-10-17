# @agent-native/network

The network host plugin. It turns the site policy's bindings into the host's only path off the machine. It provides the egress guard as the network port, starts the loopback proxy for declared child processes in a serving host, and provides the mutual TLS listener as the ingress port when the policy selects it. Its `network export` renders the same bindings as default-deny OS and orchestrator rules for the paths the in-process guard cannot see.

Layer: plugins (`plugins/*`), shipped with the framework. Server only, except `plugin-manifest`.

## Primitives

- [Egress guard](../../docs/primitives.md#egress-guard): `networkPlugin`, `networkPluginManifest`, `openNetwork`, `networkServiceOf`, `NetworkService`, `policyIngress`.
- [Execution host](../../docs/primitives.md#execution-host): `networkRules`, `exportRules`, `exportFormats`, `networkCommand`, `networkCliCommand`, `networkUsage`.
- [Host plugin](../../docs/primitives.md#host-plugin): `networkPlugin` requires `site`. It is written only against `@agent-native/host/plugin` and reads the event-log port through the composed ports.

The [architecture](../../docs/architecture.md#plugins) explains why network and audit reach each other only through ports. [Security and compliance](../../docs/security-and-compliance.md) describes the controls for operators.

## Entrypoints

| Import                                  | Runs in            | Contents                                                                                                        |
| --------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `@agent-native/network`                 | server only        | The exports listed under Primitives.                                                                            |
| `@agent-native/network/*`               | server only        | One source file each. Only `plugin-manifest` is browser-safe.                                                   |
| `@agent-native/network/plugin-manifest` | browser and server | `networkPluginManifest`. It declares nothing; it binds what others declare.                                     |
| `@agent-native/network/plugin`          | server only        | `networkPlugin`, for `defineApplication({ plugins })`.                                                          |
| `@agent-native/network/open`            | server only        | `openNetwork`, and `networkServiceOf` for code that needs the guard itself.                                     |
| `@agent-native/network/exporters`       | server only        | `exportRules` for `json`, `nftables`, `windows-firewall`, `k8s-networkpolicy`, `k8s-pod`, `compose`, `systemd`. |
| `@agent-native/network/cli`             | server only        | `network export`.                                                                                               |

`rules` (`networkRules`) and `ingress` (`policyIngress`) are importable by path. `exporters/` has one file per format plus the shared header, YAML and service defaults.

What the plugin does at each lifecycle hook:

| Hook       | Effect                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `open`     | Builds the guard over the site policy, starts the child proxy when serving, and provides `network` and, under TLS or mTLS, `ingress`. |
| `describe` | `{ mode, ingress }` for the `listening` record.                                                                                       |
| `close`    | Stops the proxy. Plugins opened later, such as `audit`, have closed by then, so a final forwarder flush still has the guard.          |

## Trust boundary

The plugin reads the site plugin's resolved policy and never reads caller input or settings of its own. The guard records each decision into the composed event-log port, read on each call because the plugin that provides it, normally `audit`, opens later. Without an event-log provider, decisions go unrecorded and never block. With one in fail-closed mode, an unrecordable connection is refused. `childEnvironment` points a declared process at the loopback proxy, which is limited to that process's declared destinations. An embedded authority does not start the proxy, so children are refused there.

Rule exports are default-deny and carry the policy digest. They list each bound destination they could not enforce by address instead of widening it. They refuse a policy with error findings, like startup.

Gaps: the guard is in-process. Real containment needs the exported rules applied, and the exports are compared as text, not loaded into a firewall or cluster.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/egress`, `@agent-native/adapters/cli`, `@agent-native/host` (`plugin`, `plugin-manifest`, `manifest`, `components`) and `@agent-native/site` (the policy it binds). No external packages.

## Tests

```sh
bun test plugins/network
UPDATE_GOLDEN=1 bun test plugins/network   # after an intended exporter change; review the diff
bun test plugins/webhook examples/project-tasks/test/security.test.ts examples/project-tasks/test/hardening.test.ts
```

`test/network.test.ts`:

- rule exports against golden files in `test/golden`;
- the guard recording into an event log composed after it;
- a connected policy refused without this plugin.

The webhook suite shows a third-party plugin refused by the guard for an unbound destination. The project-tasks suites cover bound and refused provider destinations, the child proxy and mTLS. `bun run test:isolated` and `bun run test:sandbox` check that no path escapes it.
