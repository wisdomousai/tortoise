# @agent-native/process

The process [host plugin](../../docs/glossary.md#host-plugin). It provides the kernel's [process port](../../docs/glossary.md#process-port), which starts the child processes that modules and host components declare. Each start uses the executable, arguments, working directory, pin and environment variables that the [site policy](../../docs/glossary.md#site-policy) binds under `processes`. Server code that needs a child, such as a perception worker or a hardware driver, asks the port by process ID and never names an executable itself.

## Layer

Plugins (`plugins/*`), shipped with the framework. Server only, except `plugin-manifest`. The plugin trusts the site policy as the only source of executables, and the site plugin to have validated it.

## Primitives

- [Host plugin](../../docs/primitives.md#host-plugin): `processPlugin`, `processPluginManifest`, `openProcesses`. `processPlugin` requires `site` and provides the `processes` port. It is written only against `@agent-native/host/plugin`.
- [Requirement declaration](../../docs/primitives.md#requirement-declaration): a process declares `secrets`, the environment variable names it needs, and no values.
- [Site policy](../../docs/primitives.md#site-policy): the `processes` section binds each declared process to an absolute executable, or disables it.
- [Egress guard](../../docs/primitives.md#egress-guard): a process that declares destinations gets the network port's `childEnvironment`, which points it at the loopback proxy.
- [Audit log](../../docs/primitives.md#audit-log): every start, refusal and exit is a `child.started`, `child.refused` or `child.exited` record.
- [Process port](../../docs/primitives.md#process-port): the port this plugin provides. [Hardware drivers](../../docs/hardware-drivers.md) use it most.

## Entrypoints

| Import                                  | Runs in            | Contents                                                                     |
| --------------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| `@agent-native/process`                 | server only        | The exports listed under Primitives.                                         |
| `@agent-native/process/*`               | server only        | One source file each. Only `plugin-manifest` is browser-safe.                |
| `@agent-native/process/plugin-manifest` | browser and server | `processPluginManifest`. It declares nothing; it starts what others declare. |
| `@agent-native/process/plugin`          | server only        | `processPlugin`, for `defineApplication({ plugins })`.                       |
| `@agent-native/process/open`            | server only        | `openProcesses`, the port over the resolved policy.                          |

`decide.ts` holds availability and the environment. `spawn.ts` is the only file that starts or kills a process. It is the boundary check's one exemption for this plugin.

Callers on Bun type the result with `bunProcesses(ports.processes)` from `@agent-native/host/plugin`. It returns the child's streams and a `terminate` that stops the child's whole tree. Applications get the port in `connect` as `processes`.

`spawn(id, { inputs })` passes data on inherited descriptors 3, 4 and up, each ending after its bytes. It serves a launcher that reads a filter or a file by descriptor. The [execution host](../execution-host/README.md) gives bubblewrap its options, seccomp filter and files this way. Inputs work on POSIX only; on Windows, a start with inputs is `UNAVAILABLE`.

What the plugin does at each lifecycle hook:

| Hook       | Effect                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| `open`     | Reads the site plugin's resolved policy and provides `processes`.          |
| `describe` | `{ bound }`, the process IDs the policy binds, for the `listening` record. |
| `close`    | Stops every child still running; later starts reject with UNAVAILABLE.     |

## Trust boundary

### Executable

The executable comes only from the site policy. The policy refuses a relative executable or working directory, a binding for an undeclared process, and an unbound required process. Each start rechecks availability in this order:

1. declared;
2. not disabled;
3. bound;
4. secrets storable;
5. network confinable.

A pinned executable is hashed before every start, and a mismatch is `FORBIDDEN`. The child starts without a shell. On POSIX it has its own process group, so `terminate` reaches its descendants: SIGTERM, then SIGKILL after two seconds. On Windows, `taskkill /T` stops the tree.

### Environment

A child does not inherit the host's environment. It gets, in order:

1. the platform basics: `SystemRoot`, `WINDIR`, `TEMP`, `TMP`, `TMPDIR`, `LANG` and `LC_ALL`;
2. the binding's `env`;
3. the proxy variables, if it declares destinations;
4. its declared secrets from the plugin's secret store, under `<process>.<NAME>`.

The policy cannot set the proxy variables, a declared secret's name, or loader variables such as `PATH`, `LD_PRELOAD`, `DYLD_*`, `NODE_OPTIONS` and `PYTHONPATH`. A missing secret is `UNAVAILABLE`, and the error names the variable, never the value.

### Network and audit

A process that declares destinations runs only under a serving host, where the network plugin runs the proxy. With a fail-closed [audit log](../../docs/glossary.md#audit-log), a start that cannot be recorded is stopped again and rejected.

### Known gaps

- The Bun platform has no secret store, so a process that declares secrets is unavailable there.
- This plugin does not confine a child without network destinations. The child can still open sockets unless the deployment applies the network plugin's exported rules or an OS sandbox.
- Resource limits on memory, CPU and file handles are the deployment's, and the plugin sets none. The execution host sets them for its sandboxes.

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

`packages/kernel/test/processes.test.ts` covers the refusing default and two providers refused at composition. The station's perception tests run the worker protocol over an injected start.

## Skills

- [write-hardware-driver](../connector-driver/skills/write-hardware-driver/SKILL.md): driver contracts, SDKs and driver checks.
- [deploy-to-site](../site/skills/deploy-to-site/SKILL.md): site policy, signed bundles and install.
