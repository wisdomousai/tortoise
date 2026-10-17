# @agent-native/execution-host

The execution host plugin. It runs the tools an agent uses (a coding agent's shell commands, a provider CLI, a script that calls the application's CLI or MCP server) in Linux bubblewrap sandboxes. A sandbox sees only the tools and paths its task names, reaches the network only through the egress proxy, and holds one credential: a token bound to its run and its delegation grant, which this plugin issues and revokes.

Layer: plugins (`plugins/*`). Server only, except `plugin-manifest` and `contracts`. Linux only; on other platforms every sandbox reports itself unavailable and says why.

## Primitives

- [Execution host](../../docs/primitives.md#execution-host): `createExecutionHostPlugin`, its service `ExecutionHost` (`availability`, `start`, `run`) and `createExecutionHost`.
- [Requirement declaration](../../docs/primitives.md#requirement-declaration): `executionSandbox({ id, description, network? })` declares one sandbox as a process whose executable is `bwrap`, with the destinations it may reach.
- [Process port](../../docs/primitives.md#process-port): every sandbox is started through it, so the site policy binds and can pin the bwrap executable, and the start is audited like any child.
- [Egress guard](../../docs/primitives.md#egress-guard): a sandbox that declares destinations gets the CONNECT proxy, with the per-process credential the network port issues.
- [Execution context](../../docs/primitives.md#execution-context): a task's context must carry a delegation grant; the run's token ends when the grant or the run ends.
- [Host plugin](../../docs/primitives.md#host-plugin): the plugin's `authenticate` hook answers for the tokens it issued.
- [Event log](../../docs/primitives.md#event-log): `sandbox.started` and `sandbox.exited` records with the run's principal and run ID.

## Wiring an application

1. List `executionSandbox({ id: 'agent-tools', description, network: ['model-api'] })` in the manifest's `components`, and `executionHostPluginManifest` after the site, network and process plugin manifests.
2. Add `createExecutionHostPlugin({ tools: { bun: '/usr/local/bin/bun', git: '/usr/bin/git' } })` to `plugins`. Only these executables are mounted; a task names one of them.
3. Bind the sandbox in the site policy: `"processes": { "agent-tools": { "executable": "/usr/bin/bwrap", "sha256": "…" } }`.
4. From trusted host code (an agent run, a trigger job), take `services['execution-host']` and call `run({ sandbox, command, context, workdir?, readOnly?, env?, stdin?, limits?, signal? })`. `context` is who the sandbox acts as, usually from `agentGrant`.

The result has the exit code or signal, stdout and stderr up to the output limit, and whether the run timed out, was truncated or was cancelled. `start` returns the run with `revoke()` and `cancel()` before it ends.

## Entrypoints

| Import                                         | Runs in            | Contents                                                     |
| ---------------------------------------------- | ------------------ | ------------------------------------------------------------ |
| `@agent-native/execution-host`                 | server only        | Everything below.                                            |
| `@agent-native/execution-host/contracts`       | browser and server | `executionSandbox`.                                          |
| `@agent-native/execution-host/plugin-manifest` | browser and server | `executionHostPluginManifest`. It declares nothing itself.   |
| `@agent-native/execution-host/plugin`          | server only        | `createExecutionHostPlugin`.                                 |
| `@agent-native/execution-host/run`             | server only        | `createExecutionHost`, the task and result types.            |
| `@agent-native/execution-host/seccomp`         | server only        | `seccompFilter`, `seccompProgram` and the denied call list.  |
| `@agent-native/execution-host/bwrap`           | server only        | The bubblewrap layout and the paths inside the sandbox.      |
| `@agent-native/execution-host/broker`          | server only        | `createBroker`: the run-bound tokens.                        |
| `@agent-native/execution-host/limits`          | server only        | `SandboxLimits` and their defaults.                          |

`sandbox/launcher.ts` is not an entrypoint: it is the first process inside each sandbox.

## How a run works

1. The task is checked: the command names a declared tool, paths are absolute, and no variable the sandbox sets itself (`PATH`, `HOME`, the proxy and connection variables) is overridden.
2. The broker issues a token for the task's context, bound to its principal, workspace and run, ending at the earlier of the grant's expiry and the wall-time limit.
3. The plugin starts a unix socket relay to the host's own loopback listener and, for a sandbox with destinations, one to the egress proxy, in a private run directory.
4. It records `sandbox.started`; with a fail-closed event log, a run that cannot be recorded does not start.
5. It starts the declared process through the process port with `--args 3`, passing the options, the seccomp filter, the launcher, the launch file and the connection file on descriptors 3 to 7. Nothing secret is on the command line or the host disk.
6. Inside, the launcher opens TCP listeners on 127.0.0.1 at the host's API port and the proxy port, forwarding to the relays, so the connection file and proxy variables look as they do outside. It lowers the resource limits and starts the task.
7. Wall time and output size are enforced from outside. When the task exits, bubblewrap's init ends the PID namespace, so nothing the task started survives. The token is revoked, the relays close, the run directory is removed, and `sandbox.exited` is recorded.

## Trust boundary

The caller of `run` is trusted host code and decides the task and its context. The sandbox is not trusted.

- **Namespaces.** Every namespace is new, with user, PID, network, IPC, UTS and cgroup among them. Nested user namespaces are disabled, all capabilities are dropped, the session is new (no terminal injection), and the sandbox dies with its parent.
- **Files.** The root is an empty tmpfs. It holds the C library and certificate directories, the runtime and declared tools at their host paths, `readOnly` paths, `/work` (the task's `workdir` read-write, or an empty directory), a private `/tmp`, `/proc` for the sandbox's own PIDs and a minimal `/dev`. There is no `/etc/passwd`, no home directory and no `/usr/bin` beyond the declared tools.
- **Kernel calls.** A seccomp filter (`seccomp.ts`) denies with EPERM mounting and the new mount API, namespace creation (`unshare`, `setns`, and `clone` with namespace flags), `ptrace` and cross-process memory, module, BPF and kexec loading, keyrings, `userfaultfd`, `perf_event_open`, `io_uring`, clock and swap changes, `personality` and `open_by_handle_at`. `clone3` answers ENOSYS so the C library falls back to `clone`. Another architecture or the x32 ABI is killed. Filters exist for x86-64 and arm64.
- **Network.** The network namespace has loopback only. The two relays connect to fixed ports, so the sandbox can reach the host API, where its token is checked on every request, and the egress proxy, where its process ID's declared destinations are checked and audited. It cannot reach any other host port or address. A sandbox without destinations gets no proxy relay.
- **Credentials.** The token stands for the run's context only and is refused once revoked, expired or the run ended. The host checks it per request through `authenticate`, and policy and the grant are still checked inside each transaction. No provider key, owner session or grant file enters the sandbox.
- **Limits.** Wall time (default 60 s) and output (1 MiB per stream) stop the sandbox. The launcher sets the process count, open files, file size and, if given, CPU seconds; core dumps are off.

Gaps:

- Linux only. macOS `sandbox-exec` and Windows AppContainer backends are not built; on those platforms `availability` explains and `run` is UNAVAILABLE.
- No Landlock ruleset. The mount namespace already decides which files exist in the sandbox, so Landlock would restrict the same paths a second time; it would matter for a backend without a private mount namespace.
- No memory limit. `RLIMIT_AS` breaks JavaScript runtimes, which reserve large address ranges, and cgroup limits need a delegated cgroup that an unprivileged host does not have.
- The process count limit counts threads, and is per user inside the sandbox's user namespace.
- Bubblewrap must be allowed to create user namespaces. Some distributions restrict that through AppArmor or a sysctl; the run then fails with bubblewrap's error in stderr.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/host` (`plugin`, `plugin-manifest`) and `@agent-native/runtime` (types). The application composes the site, network and process plugins. On the host: bubblewrap 0.8 or later and a C library the launcher can load (glibc or musl).

## Tests

```sh
bun test plugins/execution-host
bun run test:execution-host:linux
```

`test/execution-host.test.ts` runs anywhere. It evaluates the seccomp program for both architectures (denied, allowed, `clone` flags, `clone3`, wrong architecture and x32) and checks its encoding, the bubblewrap layout, and the broker's binding, expiry and revocation.

`test/sandbox.test.ts` runs only on Linux with bubblewrap; `test:execution-host:linux` runs it in a container built from `test/linux/Dockerfile`. It serves the notes fixture application with the site, network, process and execution host plugins, and runs `test/fixtures/probe.ts` in sandboxes:

- a two-step task through the application CLI and through an MCP client, each committing what its grant covers, with the receipt's revisions checked and a note outside the grant refused;
- a host file outside the profile, `/etc/passwd`, a write to a read-only path, an undeclared tool, the host's environment, other PIDs, another loopback port, an outside address, and `mount`, `unshare`, `ptrace` and `chroot` through libc, all failing, and the kernel limits in force;
- the proxy admitting the declared destination and refusing another;
- expired grants and revoked tokens refused at the next call;
- a process left behind not outliving the sandbox;
- output, wall-time and cancellation stops.

## Skills

- [run-agent-tools-in-a-sandbox](skills/run-agent-tools-in-a-sandbox/SKILL.md): declaring a sandbox, binding bubblewrap and running a task under a grant.
