# Security and assurance

This guide is for teams that must admit the application into a restricted network. It covers what the app may reach, how that is enforced, how every action is recorded, and how an auditor checks all of it, both before deployment and while the app runs. The design decision is recorded in [ADR 007](decisions/007-declared-egress-and-audit-log.md).

All of this is provided by two [host plugins](primitives.md#host-plugin) the application composes ([ADR 010](decisions/010-host-plugins.md)). `@agent-native/security` binds, enforces and records. `@agent-native/assurance` lets auditors read posture and the log, and adds the CLI verbs. The host itself is deny-by-default: an application without the security plugin reaches nothing off the host and keeps no audit log. Every example composes both plugins. A setting passed explicitly without the plugin that reads it, such as `--site-policy` for an application without `security`, refuses to start rather than run unenforced. Environment variables are read only for the settings composed plugins declare, so `AGENT_NATIVE_SITE_POLICY` set for an application without `security` is ignored, not refused. Check the `plugins` field of the service's `listening` record to see what is enforced.

The model has four parts:

1. **Declare.** Code states everything it may need: network destinations, devices and child processes.
2. **Bind.** A per-site policy file opens only what that site allows. Without a policy, nothing off the host is reachable.
3. **Enforce.** An in-process guard refuses everything else. Generated OS and orchestrator rules give a second layer.
4. **Observe.** An injected, hash-chained event log records every business action, denial and connection. It fails closed by default.

## 1. Declarations

Each capability module and host component declares `requirements` (`packages/contracts/src/requirements.ts`). The host adds its own components (`hostComponents` in `packages/host/src/components.ts`); each plugin adds its components through its plugin manifest (the security plugin's `audit-collector`, the webhook example's `webhook-target`); an application adds the components it brings, such as a screen bridge or device drivers, through `components` in its manifest. `deploymentCatalog(manifest)` composes them all:

```ts
defineHostComponent({
  id: 'security',
  description: 'Security plugin: forwards audit events off the host as RFC 5424 syslog.',
  requirements: {
    network: [
      {
        id: 'audit-collector',
        purpose: 'Forward audit events off the host (RFC 5424 syslog over TLS).',
        direction: 'egress',
        scope: 'site', // loopback | site | internet
        protocol: 'tcp',
        dataClasses: ['audit-event'],
        availability: 'optional', // or required
        offline: 'degrade', // queue | degrade | unavailable
      },
    ],
    devices: [],
    processes: [],
  },
});
```

- `host` is set only for fixed vendor endpoints such as `api.openai.com`. Site systems are named by the site policy.
- `targets` lists the outbox targets carried over a destination. The catalog build rejects an outbox target without a declared destination, and requires such destinations to declare `offline: 'queue'`.
- `processes[].network` lists the only destinations a child process may reach.
- A capability's `audit.fields` names input fields that are safe to record in plain text. All other input is recorded only as a SHA-256 digest.

`buildCatalog` checks that IDs are unique and references resolve. The composed declarations appear in each application's `docs/reference/<id>/contract.json` and in its generated security manifest.

## 2. Site policy

A site policy is deployment data, not code. It is validated against the composed declarations (`packages/egress/src/policy.ts`). Check one with `app security check --site <file>`.

```json
{
  "profile": "sandbox",
  "mode": "connected",
  "destinations": {
    "mes-api": { "url": "https://mes.plant.local:8443", "addresses": ["10.20.0.15/32"] },
    "openai-api": { "disabled": true, "reason": "No cloud inference on the line." }
  },
  "audit": { "mode": "fail-closed", "forwardTo": "audit-collector" },
  "identity": "grant-file",
  "grants": { "maxTtlSeconds": 3600 }
}
```

Validation rules:

- Bindings must name declared destinations and match the declared protocol, host and port.
- `addresses` (CIDRs) let the guard check DNS answers, which closes DNS rebinding. They are also required for firewall export. A binding without addresses gets a `HOSTNAME_ONLY` warning and is never widened.
- `ca` replaces the trust store for a destination. `certificatePins` pin server certificates by SHA-256 fingerprint.
- In `connected` mode, every `required` destination must be bound or explicitly disabled. Every closed destination is listed with its offline consequence.

`examples/quality-inspection/site-policy.sandbox.json` is a complete sandbox example for the quality-inspection application. `apps/desktop/site-policy.json` ships with the desktop build and binds only the provider endpoints.

### Profiles

Each profile sets a floor. The service refuses to start below it, and `security check` reports the same findings.

| Floor                      | desktop-local       | sandbox                                   | zero-trust                                     |
| -------------------------- | ------------------- | ----------------------------------------- | ---------------------------------------------- |
| Network default            | isolated            | isolated                                  | isolated                                       |
| Plain HTTP/WS off the host | allowed if declared | refused                                   | refused; TLS with a CA bundle or pins required |
| Ingress                    | loopback only       | loopback, or mTLS                         | loopback, or mTLS                              |
| Identity                   | local owner         | launcher grant (`grant-file`) or external | external only                                  |
| Audit log                  | configurable        | fail-closed                               | fail-closed and forwarded off the host         |
| Delegated grants           | as issued           | must expire within `grants.maxTtlSeconds` | as sandbox, at most one hour                   |

How the security plugin enforces the identity floor through the host's identity port:

- **`grant-file`:** the host issues no local-owner session and writes no owner credential file. Only the launcher grant is admitted, and its expiry must fall within the policy maximum. Embedded CLI and MCP calls follow the same rule.
- **`external`:** startup refuses, because this framework composes no workforce identity adapter. It does not fall back to the local owner.

With `mtls`, the security plugin provides the host's ingress port: the listener binds the configured host and port. It admits only clients whose certificate chains to `clientCa`, and every API call still needs a session token. Certificate and key paths resolve next to the policy file and are passed to the TLS stack as paths.

## 3. Enforcement

**In-process guard** (`packages/egress`). The security plugin provides it as the host's network port, so every outbound connection of the host and its plugins passes through it:

- **Requests to a destination:** a scoped `fetch` per destination. It allows only the bound scheme, host and port, checks every redirect hop, applies CA or pin settings, checks resolved addresses against `addresses`, and caps response size and time.
- **Provider SDKs:** `routedFetch` selects the bound destination by origin and explains any refusal (`UNBOUND`, `DISABLED`, `ORIGIN_MISMATCH`).
- **Raw TCP:** `socket` for TCP transports.
- **Child processes:** a loopback CONNECT proxy for declared children. `childEnvironment(processId)` sets `HTTPS_PROXY`, and the proxy tunnels only to that process's declared destinations.

A refusal raises `EgressDenied`, an `UNAVAILABLE` application error (HTTP 503, CLI exit 8), and is logged as `egress.denied`. The Electron shell applies the same declarations to renderer requests.

**Boundary rule.** `bun run check:boundaries` fails when server code uses any of these directly, outside `packages/egress`:

- global `fetch`, including `?? fetch` fallbacks;
- `Bun.connect`, `Bun.spawn` or `WebSocket`;
- `node:http`, `node:https`, `node:tls` or `node:dgram`;
- `node:net` sockets;
- `child_process`.

The few reviewed exceptions are listed with their reasons in `egressExemptions` (`scripts/boundary-rules.ts`). An exemption that no longer matches anything fails the check, so the list stays current.

**Generated rules.** These cover code paths the guard cannot see: a child that ignores proxy settings, a dependency opening its own socket, or a compromised process. Generate them with `app security export --site <file> --format <format> [--resolver ip]...`. Every format is default-deny, carries the policy digest, and lists any binding it could not enforce.

| Format              | Enforces                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nftables`          | Egress for the service's OS user, by address and port; DNS only to the given resolvers.                                                                     |
| `windows-firewall`  | Program-scoped PowerShell rules. Windows block rules take precedence over allow rules, so the export blocks the complement of the allowed ranges and ports. |
| `systemd`           | A hardened unit: `IPAddressDeny=any` plus `IPAddressAllow`, read-only system, private devices and temp, no capabilities, system-call filter.                |
| `k8s-networkpolicy` | Egress and ingress for the pod.                                                                                                                             |
| `k8s-pod`           | Non-root, read-only root filesystem, all capabilities dropped, RuntimeDefault seccomp.                                                                      |
| `compose`           | Container hardening only. Compose cannot filter by destination, and the file says so.                                                                       |
| `json`              | The firewall-neutral rule set, for other tools.                                                                                                             |

The rules are exported, never applied: applying them is a deployment step. The goldens in `plugins/assurance/test/golden` are text comparisons. The rules have not been loaded into `nft`, Windows Firewall, systemd or a cluster here.

## 4. Event log

`EventLogPort` is a runtime option (`ApplicationOptions.eventLog`); the host passes the one its `eventLog` port provider opens, which is the security plugin. With it injected, the runtime records:

- every command, query, denial and outbox transition;
- every inbound sync pass;
- every guard decision;
- harness runs;
- host startup.

The event kinds are listed in `auditEventKinds` (`packages/contracts/src/audit.ts`). Events carry the actor (principal, run, grant, channel), the operation, a safe reason code, correlation IDs, an input digest and allow-listed data only.

The JSONL adapter (`packages/event-log`):

- **Chain and checkpoints:** it chains events with SHA-256 across size-rotated segments and writes periodic checkpoints.
- **Durability:** it syncs every append, stores files with mode 0600, and holds an OS lock so each log directory has one writer.
- **Location:** the default is `<workspace>/audit`. Set the security plugin's `--audit-log` setting (or `AGENT_NATIVE_AUDIT_LOG`) to put it outside the workspace.

**Fail-closed ordering.** `command.accepted` is appended inside the storage transaction, after final authorization. If that append fails, the transaction rolls back and nothing commits. `command.committed` follows the commit. If the process dies between the two, startup resolves the open entry against the receipt store and records `command.recovered` or `command.aborted`. Set `audit.mode: "best-effort"` to trade this guarantee for availability; sandbox and zero-trust refuse that setting.

**Attestation.** The security plugin's `ready` hook, which runs before the first request, records `config.loaded` (executable, catalog and policy digests, profile) and `policy.loaded` (findings and offline consequences). An auditor can match a running instance to the SBOM and manifest.

**Forwarding.** `audit.forwardTo` sends events to a bound `audit-collector` as RFC 5424 syslog with octet framing. The connection goes through the egress guard like any other.

## 5. Assurance bundle

`bun run generate` writes these files to `docs/reference/<id>/` for each application, and the shared control catalog to `docs/reference/`. CI fails if they drift from the code.

| File                           | Contents                                                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `security-manifest.json`       | Every declared destination, device and process with its owner, and every operation whose effects leave the host.                                                                         |
| `data-flows.md`                | Mermaid diagram and tables of the same, including which data classes go where.                                                                                                           |
| `controls.json`, `controls.md` | Control catalog `AN-*`, mapped to ISO/IEC 27001:2022 Annex A, NIST SP 800-53 r5, NIST CSF 2.0 and IEC 62443-4-2, each with evidence: tests to re-run, artifacts and runtime event kinds. |
| `sbom.cdx.json`                | CycloneDX 1.6 from `bun.lock`: components with purl, hashes and runtime/dev scope; declared destinations as services with trust zones and data flows. Deterministic, with no timestamp.  |

The control mappings are indicative. They name the requirement each control contributes to; certification still needs the organization's own scope and the licensed standard text.

## 6. Checking it

Every application that composes the assurance plugin has these commands (`plugins/assurance/src/cli.ts`, contributed through the plugin's `commands`). They work offline and need no authority or workspace:

```sh
app security check --site site-policy.json            # exit 2 on any error finding
app security export --site site-policy.json --format nftables --resolver 10.20.0.53
app audit verify --log /var/lib/app/audit             # exit 10 if the chain is damaged
app audit report --log /var/lib/app/audit --site site-policy.json --format markdown
```

While the app runs, a posture monitor re-verifies the chain up to the writer's current head every 15 minutes and on demand. It folds egress events into per-destination usage and records `posture.checked`; it never probes the network.

Auditors see the result through three read-only queries:

- `assurance.posture.get`
- `assurance.events.list` (paged; filter by kind or outcome; newest first)
- `assurance.log.verify`

The **Security** screen (`security-screen` in the assurance plugin's registry, routed at `/security` by the plugin) uses the same queries and shows a denial within seconds. Only principals listed as auditors may read these. A delegated grant must name the operation and, if it is limited to specific resources, `audit:log`.

## 7. Offline first

With no site policy the app runs isolated:

- loopback only;
- outbox targets queue visibly;
- inference providers report unavailable;
- the deterministic harness keeps working.

`bun run test:isolated` runs the whole suite with a trap that fails on any non-loopback connection from the test process. `bun run test:sandbox` runs the compiled binary in an empty environment, then checks its audit chain and that no egress was attempted.

## Limits

- The guard and proxy are in-process controls. Real containment needs the exported rules applied, or an OS sandbox. No isolation backend ships here.
- A process running as the workspace owner can read the workspace and log files directly. Hash chaining detects later edits, but it cannot stop deleting the log's tail; off-host forwarding covers that.
- There is no workforce identity adapter and no certificate issuance or rotation. Zero trust refuses to start rather than fall back.
- The `test:isolated` trap does not cover child processes.
- Device access (serial, HID, camera) is declared but not mediated by the guard. The systemd export's `PrivateDevices=yes` must be relaxed with `DeviceAllow=` for declared devices.
