# @agent-native/execution-host

The [execution host](../../docs/glossary.md#execution-host) plugin runs the tools an agent uses in Linux bubblewrap sandboxes. Such a tool is a coding agent's shell command, a provider CLI, or a script that calls the application's CLI or MCP server. A sandbox sees only the tools and paths its task names, and reaches the network only through the egress proxy. It holds one credential: a token bound to its [agent run](../../docs/glossary.md#agent-run) and its delegated [grant](../../docs/glossary.md#grant), which this plugin issues and revokes.

## Layer

Plugins (`plugins/*`). Server only, except `plugin-manifest` and `contracts`. Linux only. On other platforms every sandbox reports itself unavailable and says why.

## Primitives

- [Execution host](../../docs/primitives.md#execution-host): `createExecutionHostPlugin`, its service `ExecutionHost` (`availability`, `start`, `run`) and `createExecutionHost`.
- [Requirement declaration](../../docs/primitives.md#requirement-declaration): `executionSandbox({ id, description, network? })` declares one sandbox as a process whose executable is `bwrap`, with the [destinations](../../docs/glossary.md#destination) it may reach.
- [Process port](../../docs/primitives.md#process-port): every sandbox starts through it. The [deployment policy](../../docs/glossary.md#deployment-policy) therefore binds and can pin the bwrap executable, and the start is audited like any child.
- [Egress guard](../../docs/primitives.md#egress-guard): a sandbox that declares destinations gets the CONNECT proxy, with the per-process credential the network port issues.
- [Execution context](../../docs/primitives.md#execution-context): a task's context must carry a delegated grant. The run's token ends when the grant or the run ends.
- [Host plugin](../../docs/primitives.md#host-plugin): the plugin's `authenticate` hook answers for the tokens it issued.
- [Audit log](../../docs/primitives.md#audit-log): `sandbox.started` and `sandbox.exited` records with the run's [principal](../../docs/glossary.md#principal) and run ID.

## Entrypoints

| Import                                         | Runs in            | Contents                                                     |
| ---------------------------------------------- | ------------------ | ------------------------------------------------------------ |
| `@agent-native/execution-host`                 | server only        | Everything below except `relay`.                             |
| `@agent-native/execution-host/contracts`       | browser and server | `executionSandbox`.                                          |
| `@agent-native/execution-host/plugin-manifest` | browser and server | `executionHostPluginManifest`. It declares nothing itself.   |
| `@agent-native/execution-host/plugin`          | server only        | `createExecutionHostPlugin`.                                 |
| `@agent-native/execution-host/run`             | server only        | `createExecutionHost`, the task and result types.            |
| `@agent-native/execution-host/seccomp`         | server only        | `seccompFilter`, `seccompProgram` and the denied call list.  |
| `@agent-native/execution-host/bwrap`           | server only        | The bubblewrap layout and the paths inside the sandbox.      |
| `@agent-native/execution-host/broker`          | server only        | `createBroker`: the run-bound tokens.                        |
| `@agent-native/execution-host/limits`          | server only        | `SandboxLimits` and their defaults.                          |
| `@agent-native/execution-host/relay`           | server only        | `startRelay`: the host side of a sandbox's socket relay.     |

`sandbox/launcher.ts` is not an entrypoint. It is the first process inside each sandbox.

### Composition

1. List `executionSandbox({ id: 'agent-tools', description, network: ['model-api'] })` in the manifest's `components`. List `executionHostPluginManifest` after the site, network and process plugin manifests.
2. Add `createExecutionHostPlugin({ tools: { bun: '/usr/local/bin/bun', git: '/usr/bin/git' } })` to `plugins`. Only these executables are mounted, and a task names one of them.
3. Bind the sandbox in the deployment policy: `"processes": { "agent-tools": { "executable": "/usr/bin/bwrap", "sha256": "…" } }`.
4. From trusted host code, such as an agent run or a trigger job, take `services['execution-host']` and call `run({ sandbox, command, context, workdir?, readOnly?, env?, stdin?, limits?, signal? })`. `context` is who the sandbox acts as, usually from `agentGrant`.

The result has the exit code or signal, and stdout and stderr up to the output limit. It also says whether the run timed out, was truncated or was cancelled. `start` returns the run with `revoke()` and `cancel()` before it ends.

## Trust boundary

The caller of `run` is trusted host code and decides the task and its context. The sandbox is not trusted.

### Run sequence

1. The plugin checks the task: the command names a declared tool, paths are absolute, and no variable the sandbox sets itself is overridden. Those variables are `PATH`, `HOME`, and the proxy and connection variables.
2. The broker issues a token for the task's context, bound to its principal, workspace and run. The token ends at the earlier of the grant's expiry and the wall-time limit.
3. The plugin starts a unix socket relay to the host's own loopback listener in a private run directory. A sandbox with destinations also gets a relay to the egress proxy.
4. The plugin records `sandbox.started`. With a fail-closed [audit log](../../docs/glossary.md#audit-log), a run that cannot be recorded does not start.
5. The plugin starts the declared process through the process port with `--args 3`. It passes the options, the seccomp filter, the launcher, the launch file and the [connection file](../../docs/glossary.md#connection-file) on descriptors 3 to 7, so nothing secret is on the command line or the host disk.
6. Inside, the launcher opens TCP listeners on 127.0.0.1 at the host's HTTP port and the proxy port, forwarding to the relays. The connection file and proxy variables therefore look as they do outside.
7. The launcher lowers the resource limits and starts the task. Wall time and output size are enforced from outside.
8. When the task exits, bubblewrap's init ends the PID namespace, so nothing the task started survives.
9. The token is revoked, the relays close, the run directory is removed, and `sandbox.exited` is recorded.

### Sandbox controls

- **Namespaces.** Every namespace is new, with user, PID, network, IPC, UTS and cgroup among them. Nested user namespaces are disabled, all Linux capabilities are dropped, and the OS session is new, which blocks terminal injection. The sandbox dies with its parent.
- **Files.** The root is an empty tmpfs that holds only these paths:
  - the C library and certificate directories;
  - the runtime and the declared tools at their host paths;
  - the `readOnly` paths;
  - `/work`, which is the task's `workdir` read-write or an empty directory;
  - a private `/tmp`, `/proc` for the sandbox's own PIDs and a minimal `/dev`.
- **Absent files.** There is no `/etc/passwd`, no home directory and no `/usr/bin` beyond the declared tools.
- **Kernel calls.** A seccomp filter (`seccomp.ts`) denies these calls with EPERM:
  - mounting and the new mount API;
  - namespace creation: `unshare`, `setns`, and `clone` with namespace flags;
  - `ptrace` and cross-process memory;
  - module, BPF and kexec loading;
  - keyrings, `userfaultfd`, `perf_event_open` and `io_uring`;
  - clock and swap changes, `personality` and `open_by_handle_at`.
- **Other calls.** `clone3` answers ENOSYS so the C library falls back to `clone`. Another architecture or the x32 ABI is killed, and filters exist for x86-64 and arm64.
- **Network.** The network namespace has loopback only, and the two relays connect to fixed ports. The sandbox reaches the host's HTTP API, which checks its token on every request, and the egress proxy, which checks and audits its process ID's declared destinations.
- **Other addresses.** The sandbox cannot reach any other host port or address. A sandbox without destinations gets no proxy relay.
- **Credentials.** The token stands for the run's context only and is refused once revoked or expired, or once the run ended. The host checks it per request through `authenticate`, and [policy](../../docs/glossary.md#policy) and the grant are still checked inside each transaction.
- **Secrets.** No provider key, owner [session](../../docs/glossary.md#session) or [grant file](../../docs/glossary.md#grant-file) enters the sandbox.
- **Limits.** Wall time and output stop the sandbox, by default after 60 s and 1 MiB per stream. The launcher sets the process count, open files, file size and, if given, CPU seconds, and turns core dumps off.

### Known gaps

- Linux only. macOS `sandbox-exec` and Windows AppContainer backends are not built. On those platforms `availability` explains why, and `run` is `UNAVAILABLE`.
- No Landlock ruleset. The mount namespace already decides which files exist in the sandbox, so Landlock would restrict the same paths a second time. It would matter for a backend without a private mount namespace.
- No memory limit. `RLIMIT_AS` breaks JavaScript runtimes, which reserve large address ranges. Cgroup limits need a delegated cgroup that an unprivileged host does not have.
- The process count limit counts threads, and is per OS user inside the sandbox's user namespace.
- Bubblewrap must be allowed to create user namespaces. Some distributions restrict that through AppArmor or a sysctl, and the run then fails with bubblewrap's error in stderr.

## Dependencies

- Framework: `@agent-native/contracts`, `@agent-native/host` for `plugin` and `plugin-manifest`, and `@agent-native/runtime` for types.
- Plugins: the application composes the site, network and process plugins.
- On the host: bubblewrap 0.8 or later, and a C library the launcher can load, glibc or musl.

## Tests

```sh
bun test plugins/execution-host
bun run test:execution-host:linux
```

`test/execution-host.test.ts` runs anywhere. It evaluates the seccomp program for both architectures: denied and allowed calls, `clone` flags, `clone3`, a wrong architecture and x32. It also checks the program's encoding, the bubblewrap layout, and the broker's binding, expiry and revocation.

`test/sandbox.test.ts` runs only on Linux with bubblewrap. `test:execution-host:linux` runs it in a container built from `test/linux/Dockerfile`. It serves the notes fixture application with the site, network, process and execution host plugins, and runs `test/fixtures/probe.ts` in sandboxes. It covers:

- a two-step task through the application CLI and through an MCP client, each committing what its grant covers, with the revisions in the [receipt](../../docs/glossary.md#receipt) checked and a note outside the grant refused;
- reads that fail: a host file outside the profile, `/etc/passwd`, the host's environment and other PIDs;
- actions that fail: a write to a read-only path, an undeclared tool, another loopback port, an outside address, and `mount`, `unshare`, `ptrace` and `chroot` through libc;
- the kernel limits in force;
- the proxy admitting the declared destination and refusing another;
- expired grants and revoked tokens refused at the next call;
- a process left behind not outliving the sandbox;
- output, wall-time and cancellation stops.

`test:execution-host:linux` also takes test paths and runs those in the same container instead. `patterns/sandbox` runs its own sandbox tests this way.

## Skills

- [run-agent-tools-in-a-sandbox](skills/run-agent-tools-in-a-sandbox/SKILL.md): declaring a sandbox, binding bubblewrap and running a task under a grant.

## References

- [Agents](../../docs/agents.md#harnesses)
