# @agent-native/process

The process host plugin. It provides the kernel's process port: it starts the child processes that modules and host components declare, with the executable, arguments, working directory, pin and environment variables that the site policy binds under `processes`. Server code that needs a child (a perception worker, a hardware driver) asks the port by process ID and never names an executable itself.

Layer: plugins (`plugins/*`), shipped with the framework. Server only, except `plugin-manifest`.

## Primitives

- [Host plugin](../../docs/primitives.md#host-plugin): `processPlugin`, `processPluginManifest`, `openProcesses`. `processPlugin` requires `site` and provides the `processes` port; it is written only against `@agent-native/host/plugin`.
- [Requirement declaration](../../docs/primitives.md#requirement-declaration): a process declares `secrets`, the environment variable names it needs, and no values.
- [Site policy](../../docs/primitives.md#site-policy): the `processes` section binds each declared process to an absolute executable, or disables it.
- [Egress guard](../../docs/primitives.md#egress-guard): a process that declares destinations gets the network port's `childEnvironment`, which points it at the loopback proxy.
- [Event log](../../docs/primitives.md#event-log): every start, refusal and exit is a `child.started`, `child.refused` or `child.exited` record.
- [Process port](../../docs/primitives.md#process-port): the port this plugin provides. [Hardware drivers](../../docs/hardware-drivers.md) are its main user.

## Entrypoints

| Import                                  | Runs in            | Contents                                                                     |
| --------------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| `@agent-native/process`                 | server only        | The exports listed under Primitives.                                         |
| `@agent-native/process/*`               | server only        | One source file each. Only `plugin-manifest` is browser-safe.                |
| `@agent-native/process/plugin-manifest` | browser and server | `processPluginManifest`. It declares nothing; it starts what others declare. |
| `@agent-native/process/plugin`          | server only        | `processPlugin`, for `defineApplication({ plugins })`.                       |
| `@agent-native/process/open`            | server only        | `openProcesses`, the port over the resolved policy.                          |

`decide.ts` holds availability and the environment; `spawn.ts` is the only file that starts or kills a process, and the boundary check's one exemption for this plugin.

Callers on Bun type the result with `bunProcesses(ports.processes)` from `@agent-native/host/plugin`, which returns the child's streams and a `terminate` that stops its whole tree. Applications get the port in `connect` as `processes`.

`spawn(id, { inputs })` passes data on inherited descriptors 3, 4 and up, each ending after its bytes, for a launcher that reads a filter or a file by descriptor (the [execution host](../execution-host/README.md) gives bubblewrap its options, seccomp filter and files this way). POSIX only; on Windows a start with inputs is UNAVAILABLE.

What the plugin does at each lifecycle hook:

| Hook       | Effect                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| `open`     | Reads the site plugin's resolved policy and provides `processes`.          |
| `describe` | `{ bound }`, the process IDs the policy binds, for the `listening` record. |
| `close`    | Stops every child still running; later starts reject with UNAVAILABLE.     |

## Trust boundary

The executable comes only from the site policy. The policy refuses a relative executable or working directory, a binding for an undeclared process, and an unbound required process. Each start rechecks availability in this order: declared, not disabled, bound, secrets storable, network confinable. A pinned executable is hashed before every start, and a mismatch is FORBIDDEN. The child is started without a shell. It has its own process group on POSIX, so `terminate` reaches its descendants: SIGTERM, then SIGKILL after two seconds. On Windows, `taskkill /T` stops the tree.

A child does not inherit the host's environment. It gets the platform basics (`SystemRoot`, `WINDIR`, `TEMP`, `TMP`, `TMPDIR`, `LANG`, `LC_ALL`), then the binding's `env`, then the proxy variables if it declares destinations, then its declared secrets from the plugin's secret store under `<process>.<NAME>`. The policy cannot set the proxy variables, loader variables (`PATH`, `LD_PRELOAD`, `DYLD_*`, `NODE_OPTIONS`, `PYTHONPATH` and similar) or a declared secret's name. A missing secret is UNAVAILABLE and names the variable, never the value.

A process that declares destinations runs only under a serving host, where the network plugin runs the proxy. With a fail-closed event log, a start that cannot be recorded is stopped again and rejected.

Gaps:

- The Bun platform has no secret store, so a process that declares secrets is unavailable there.
- Without network destinations a child is not confined by this plugin. It can still open sockets unless the deployment applies the network plugin's exported rules or an OS sandbox.
- Resource limits (memory, CPU, file handles) are the deployment's; the plugin sets none. The execution host sets them for its sandboxes.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/host` (`plugin`, `plugin-manifest`) and `@agent-native/site` (the policy and its resolved process bindings). No external packages.

## Tests

```sh
bun test plugins/process packages/kernel/test/processes.test.ts
```

`test/process.test.ts` starts `test/fixtures/echo-env.ts` under Bun and covers:

- policy findings for bindings, and invalid secret names at composition;
- the built environment, with nothing inherited from the host;
- audit records for starts, exits and refusals;
- disabled, unbound and undeclared processes;
- the pin check;
- inputs read from descriptors 3 and 4;
- secrets refused without a secret store;
- abort and close stopping the tree.

The kernel suite covers the refusing default and two providers refused at composition. The station's perception tests run the worker protocol over an injected start.

## Skills

- [write-hardware-driver](../connector-driver/skills/write-hardware-driver/SKILL.md): driver contracts, SDKs and driver checks.
- [deploy-to-site](../site/skills/deploy-to-site/SKILL.md): site policy, signed bundles and install.
