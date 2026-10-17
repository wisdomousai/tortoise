# Security and compliance

This guide is for teams admitting the application into a restricted network. It covers what the application may reach, how that is enforced, how its actions are recorded, and how an auditor checks all of it, both before deployment and while it runs. Each control is a host plugin; [architecture](architecture.md#plugins) explains how plugins compose.

Three choices shape the design. Reach is declared in the catalog rather than left to an OS sandbox alone, because a sandbox is not portable, is invisible to reviewers and gives the application nothing to check. The audit record of a command is written inside its transaction, because a log written afterwards allows commits that were never recorded. Firewall and service rules are generated from the same declarations, because hand-written rules drift from the code.

The model has four parts:

1. **Declare.** Code states everything it may need: network destinations, devices and child processes.
2. **Bind.** A per-site policy opens only what that site allows. Without a policy, nothing off the host is reachable.
3. **Enforce.** An in-process guard refuses everything else, and generated OS and orchestrator rules add a second layer.
4. **Record.** A hash-chained event log records business actions, denials and connections. By default it fails closed.

The host is closed by default, and [host plugins](primitives.md#host-plugin) provide each part. The examples compose all four framework plugins:

| Plugin       | Provides                                                                            | CLI                 |
| ------------ | ----------------------------------------------------------------------------------- | ------------------- |
| `site`       | The site policy, profile floors and identity                                        | `site check`        |
| `network`    | The egress guard, the proxy for child processes, mTLS ingress and exported OS rules | `network export`    |
| `audit`      | The event log, forwarding, startup attestation and crash recovery                   | `audit verify`      |
| `compliance` | Auditor queries, the posture monitor, the Compliance screen and the evidence bundle | `compliance report` |

Leaving a plugin out leaves its part closed: without `network` nothing leaves the host, and without `audit` there is no log. Configuration that would go unenforced refuses to start. That covers a setting no composed plugin reads, and a policy that asks for bindings, mTLS or an audit trail without the plugin that enforces it. Environment variables are read only for settings that a composed plugin declares, so a stray one is ignored rather than refused. The service's `listening` record lists the plugins in force.

## 1. Declarations

Capability modules, host components and plugins declare their requirements, and an application adds the components it brings, such as a screen bridge or device drivers. The deployment catalog composes them all:

```ts
defineHostComponent({
  id: 'audit',
  description: 'Forwards audit events off the host as RFC 5424 syslog.',
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

- **Fixed hosts.** A declaration names a host only for fixed vendor endpoints. The site policy names site systems.
- **Outbox targets.** An outbox target needs a declared destination that queues while offline.
- **Child processes.** A child process lists the only destinations it may reach.
- **Audit fields.** A capability lists the input fields that are safe to record in plain text. All other input is recorded as a digest.

The composed declarations appear in each application's generated contract and security manifest.

## 2. Site policy

A site policy is deployment data, validated against the composed declarations. Check one with `app site check --site <file>`.

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

- **Bindings** name declared destinations and match their protocol, host and port.
- **`addresses`** (CIDRs) let the guard check DNS answers, which defeats DNS rebinding, and the firewall exports need them. A binding without addresses gets a warning, and its scope is never widened.
- **`ca`** replaces the trust store for a destination, and **`certificatePins`** pin server certificates.
- **Connected mode** requires every required destination to be bound or explicitly disabled. Each closed destination is listed with its offline consequence.

The `quality-inspection` example ships a complete sandbox policy. The desktop build ships one that binds only provider endpoints.

### Profiles

A profile is a floor: startup refuses a policy below it, and `site check` reports the same findings.

| Floor                      | desktop-local       | site-hub                             | sandbox                              | zero-trust                                     |
| -------------------------- | ------------------- | ------------------------------------ | ------------------------------------ | ---------------------------------------------- |
| Network default            | isolated            | isolated                             | isolated                             | isolated                                       |
| Plain HTTP/WS off the host | allowed if declared | refused                              | refused                              | refused; TLS with a CA bundle or pins required |
| Ingress                    | loopback only       | loopback, TLS or mTLS                | loopback, TLS or mTLS                | loopback, or mTLS                              |
| Identity                   | local owner         | local owner, launcher grant          | launcher grant or external           | external only                                  |
| Audit log                  | configurable        | fail-closed                          | fail-closed                          | fail-closed and forwarded off the host         |
| Delegated grants           | as issued           | expire within `grants.maxTtlSeconds` | expire within `grants.maxTtlSeconds` | as sandbox, at most one hour                   |

`site-hub` is for a hub that paired phones and tablets reach over the site network: the sandbox's floors, with the person running the hub as the local owner. Devices authenticate with the credentials the [device-link plugin](../plugins/device-link/README.md) issues.

The identity settings:

- **`grant-file`:** the host issues no local-owner session and writes no owner credential. Only a launcher grant within the maximum lifetime is admitted, including for embedded CLI and MCP calls.
- **`external`:** startup refuses, because no workforce identity adapter exists yet. It never falls back to the local owner.

**TLS and mTLS.** The listener binds the configured address with the site's certificate. With `mtls` it admits only clients whose certificate chains to `clientCa`; with `tls` any client on the network completes the handshake, and a policy that sets `clientCa` on a `tls` listener is refused, since nothing would check it. Either way every API call still needs a session token or a device credential. Certificate paths resolve next to the policy file.

## 3. Enforcement

**In-process guard.** Every outbound connection of the host and its plugins passes through it:

- **Destination requests:** a fetch scoped to each destination allows only the bound scheme, host and port. It checks every redirect hop and the resolved addresses, applies CA and pin settings, and caps response size and time.
- **Provider SDKs:** they get a fetch routed by origin, which explains each refusal.
- **TCP transports:** they get a scoped socket.
- **Child processes:** declared children reach the network through a loopback CONNECT proxy that tunnels only to their declared destinations.

A refusal is an `UNAVAILABLE` error (HTTP 503, CLI exit 8) and is recorded as `egress.denied`. The desktop shell applies the same declarations to renderer requests.

`check:boundaries` fails when server code uses network, socket or process APIs directly instead of the guard. The few reviewed exemptions carry reasons, and a stale exemption fails the check.

**Generated rules** cover what the guard cannot see: a child that ignores proxy settings, a dependency that opens its own socket, or a compromised process. Generate them with `app network export --site <file> --format <format> [--resolver ip]...`. Every format denies by default, carries the policy digest, and lists any binding it could not enforce.

| Format              | Enforces                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `nftables`          | Egress for the service's OS user, by address and port; DNS only to the given resolvers.                                                |
| `windows-firewall`  | Program-scoped rules. Block rules win on Windows, so the export blocks the complement of what is allowed.                              |
| `systemd`           | A hardened unit: deny all addresses except those allowed, read-only system, private devices and temp, no capabilities, syscall filter. |
| `k8s-networkpolicy` | Egress and ingress for the pod.                                                                                                        |
| `k8s-pod`           | Non-root, read-only root filesystem, no capabilities, default seccomp.                                                                 |
| `compose`           | Container hardening only; Compose cannot filter by destination, and the file says so.                                                  |
| `json`              | The neutral rule set, for other tools.                                                                                                 |

Rules are exported, never applied; applying them is a deployment step. They are verified as text and have not been loaded into a real firewall or cluster here.

## 4. Event log

The runtime records commands, queries, denials, outbox transitions, sync passes, guard decisions, runs and host startup. Connections and business actions share one chain. Each event carries the actor (principal, run, grant and channel), the operation, a safe reason code, correlation IDs, an input digest and allow-listed fields only.

The file log chains events with SHA-256 across rotated segments and writes checkpoints. It syncs every append, keeps files private to the owner, and allows one writer per directory. It lives in the workspace unless the `audit-log` setting moves it.

- **Fail-closed ordering.** A command's acceptance is recorded inside its transaction, after final authorization. If the record fails, nothing commits. If the process dies before the commit is recorded, startup resolves the open entry against the receipts. A site can trade this for availability with `best-effort`; sandbox and zero-trust refuse that setting.
- **Attestation.** Before the first request, startup records the executable, catalog and policy digests and the policy's findings, so an auditor can match a running instance to its SBOM and manifest.
- **Forwarding.** `audit.forwardTo` sends events to a bound collector as RFC 5424 syslog. The connection goes through the guard like any other. Without the network plugin it is refused, and the forwarder counts the failure.

## 5. Compliance bundle

`bun run generate` writes these files for each application to `docs/reference/<id>/`, and the shared control catalog to `docs/reference/`. The build fails if they drift.

| File                           | Contents                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `security-manifest.json`       | Every declared destination, device and process with its owner, every operation whose effects leave the host, and in `summary.site` what pins the application to the site. |
| `data-flows.md`                | A diagram and tables of the same, with the data classes that go where.                                                                                                    |
| `controls.json`, `controls.md` | Controls mapped to ISO/IEC 27001:2022 Annex A, NIST SP 800-53 r5, NIST CSF 2.0 and IEC 62443-4-2, each with evidence: tests, artifacts and event kinds.                   |
| `sbom.cdx.json`                | CycloneDX 1.6 from the lockfile, with declared destinations as services with trust zones and data flows. Deterministic.                                                   |

The control mappings are indicative. Certification still needs the organization's own scope and the licensed standard text.

## 6. Checking it

Each plugin adds its own CLI verb, so an application has the verbs of the plugins it composes. They run offline, with no authority or workspace:

```sh
app site check --site site-policy.json                # exit 2 on any error finding
app network export --site site-policy.json --format nftables --resolver 10.20.0.53
app audit verify --log /var/lib/app/audit             # exit 10 if the chain is damaged
app compliance report --log /var/lib/app/audit --site site-policy.json --format markdown
```

While the application runs, a posture monitor re-verifies the chain on an interval and on demand. It summarizes egress per destination and never probes the network. Auditors read posture, events and chain status through ordinary read-only queries and the Compliance screen. A denial shows up there within seconds. Only listed auditors may read them, and a delegated grant must name the operation.

## 7. Offline first

With no site policy, the application is isolated:

- it listens on loopback only;
- outbox targets queue visibly;
- inference providers report themselves unavailable;
- the deterministic harness keeps working.

`bun run test:isolated` fails on any non-loopback connection from the test process. `bun run test:sandbox` runs the compiled binary in an empty environment, then checks its audit chain and that it attempted no egress.

## Limits

- The guard and proxy are in-process controls. Real containment needs the exported rules applied, or an OS sandbox.
- A process running as the workspace owner can read the workspace and the log. Chaining detects edits but cannot stop deletion of the newest entries; off-host forwarding covers that.
- There is no workforce identity adapter and no certificate issuance or rotation, so zero trust refuses to start.
- The isolated-test trap does not cover child processes.
- Devices are declared but not mediated, and the systemd export needs explicit allowances for declared devices.
