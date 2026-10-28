# Security and compliance

The [application](glossary.md#application) names the destinations, folders and programs it needs. Security [host plugins](glossary.md#host-plugin) enforce the [deployment policy](glossary.md#deployment-policy) that binds permitted resources at a [site](glossary.md#site). The [egress guard](glossary.md#egress-guard) refuses unbound network access, and the [audit log](glossary.md#audit-log) records operations, denials and connections.

The audit log is a hash chain. An auditor checks it before deployment and while the application runs.

## Controls and plugins

The controls apply in this order:

1. **Declare.** Modules, host components and plugins state what they need outside the process: destinations, exchange folders, devices and child processes.
2. **Bind.** A deployment policy opens only what one [site](glossary.md#site) allows. Without a policy, nothing off the host is reachable.
3. **Enforce.** The egress guard refuses everything else in process. Generated OS and orchestrator rules add a second layer.
4. **Record.** The audit log records business actions, denials and connections in one hash chain.

Most examples compose the four plugins below.

| Plugin | Provides | CLI verb |
| --- | --- | --- |
| `site` | The deployment policy, the hardening profile floors, identity and exchange folders | `site check` |
| `network` | The egress guard, the proxy for child processes, TLS and mTLS ingress, and exported OS rules | `network export` |
| `audit` | The audit log, forwarding, startup attestation and crash recovery | `audit verify` |
| `compliance` | Auditor queries, the posture monitor and the Compliance screen | `compliance report` |

Without `network`, nothing leaves the host. Without `audit`, the composition's audit log port keeps no log.

Startup refuses configuration that no composed plugin would enforce:

- a setting that no composed plugin declares;
- a policy that binds destinations, without the network plugin;
- a policy that selects a TLS or mTLS listener, without a plugin that provides ingress;
- a policy that asks for a fail-closed or forwarded audit log, without the audit plugin.

The host reads environment variables only for settings that a composed plugin declares, so it ignores a stray variable. It refuses a command-line flag that no plugin declares. The host's `listening` record lists the plugins in force. `packages/host/test/plugins.test.ts` and `plugins/network/test/network.test.ts` cover these refusals.

## Declarations

Modules, host components and plugins declare their requirements as data, and an application adds the host components it brings, such as a screen bridge or device drivers. The catalog composes the declarations. An OS sandbox is not portable, and the application cannot read or check the sandbox.

The audit plugin declares its collector in `plugins/audit/src/plugin-manifest.ts`:

```ts
export const auditCollectorComponent = defineHostComponent({
  id: 'audit',
  description: 'Audit plugin: forwards audit events off the host as RFC 5424 syslog.',
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
  },
});
```

Building the catalog applies these rules (`packages/contracts/src/requirements.ts`):

- **Fixed hosts.** A declaration names a host only for a fixed vendor endpoint. The deployment policy names site systems.
- **Outbox targets.** Every [target](glossary.md#target) is reached through a declared destination, exchange folder or child process. A destination that includes [outbox effects](glossary.md#effect) must queue while offline.
- **Child processes.** A child process lists the only destinations it may reach.
- **Exchange folders.** A folder that another system reads or writes is declared by ID with its access (`read`, `write` or `read-write`), data classes and outbox targets. Code reaches a folder only through the folder port, so a module never names a path.
- **Audit fields.** A capability lists the input fields that are safe to record in plain text. The audit log records the rest of the input as a digest.

## Deployment policy

A deployment policy is deployment data for one site, validated against the composed declarations. The host reads it from `--site-policy` or `AGENT_NATIVE_SITE_POLICY`. Check one with `app site check --site <file>`, which reports the same findings that refuse startup.

A policy file under the `sandbox` profile:

```json
{
  "profile": "sandbox",
  "mode": "connected",
  "destinations": {
    "mes-api": { "url": "https://mes.plant.local:8443", "addresses": ["10.20.0.15/32"] },
    "audit-collector": { "url": "tcp://10.20.0.40:6514", "addresses": ["10.20.0.40/32"], "tls": true },
    "openai-api": { "disabled": true, "reason": "No cloud inference on the line." }
  },
  "audit": { "mode": "fail-closed", "forwardTo": "audit-collector" },
  "identity": "grant-file",
  "grants": { "maxTtlSeconds": 3600 }
}
```

- **Bindings** name declared destinations and must match their protocol, host and port.
- **`addresses`** are CIDRs. The addresses let the guard check DNS responses, which defeats DNS rebinding, and the rule exports need the addresses. A binding without addresses gets a warning, and the exports keep it blocked instead of widening it.
- **`ca`** replaces the trust store for one destination, and **`certificatePins`** pin its server certificates.
- **`timeoutMs`** replaces the guard's 30-second request timeout for one destination, from 1 second to an hour. A local model server that reasons before it responds needs minutes.
- **`maxResponseBytes`** replaces the guard's 32 MiB response cap for one destination, from 1 MiB to 1 GiB. A fleet serves release files, and a site's compiled binary is larger than 32 MiB.
- **`folders`** binds each declared folder ID to an absolute directory or disables it with a reason. The directory can be a POSIX path, a Windows drive path or a UNC share. A disabled or unbound folder is unavailable through the folder port.
- **Connected mode** requires every required destination to be bound or explicitly disabled. The findings list each closed destination with its offline consequence.

Folder bindings have their own findings. Two folders cannot share a directory. An undeclared folder, or a required folder left unbound, is an error. A bound directory that does not exist is a warning, because a share may be mounted later.

The desktop build ships `apps/desktop/site-policy.json`, which binds only provider endpoints.

### Hardening profiles

A hardening profile is a floor. Startup refuses a policy below its floor (`plugins/site/src/policy/floors.ts`).

| Floor | desktop-local | site-hub and sandbox | zero-trust |
| --- | --- | --- | --- |
| Network default | Isolated | Isolated | Isolated |
| Plain HTTP or WebSocket off the host | Allowed if declared | Refused | Refused; TLS with a CA bundle or pins |
| A credential off the host (`authenticated` destination) | TLS | TLS | TLS with a CA bundle or pins |
| Ingress | Loopback only | Loopback, TLS or mTLS | Loopback or mTLS |
| Identity | Any | site-hub: any; sandbox: launcher grant or external | External only |
| Audit log | Fail-closed or best-effort | Fail-closed | Fail-closed and forwarded off the host |
| Delegated grants | Within `grants.maxTtlSeconds` when set | `grants.maxTtlSeconds` required | At most one hour |

A destination declared `https` or `wss` may be bound to plain text on loopback, such as a second instance on the same machine; the site check warns with `LOOPBACK_PLAINTEXT`. An `authenticated` destination, which includes a bearer credential or a signed assertion, is refused with `PLAINTEXT_CREDENTIAL` when it is bound to plain text off loopback, whatever the profile.

`site-hub` is for a [hub](glossary.md#hub) that paired phones and tablets reach over the site network. It has the sandbox's floors, except that the person running the hub may act as the local [owner](glossary.md#owner). Devices authenticate with the credentials that the [device-link plugin](../plugins/device-link/README.md) issues.

### Identity

The policy's `identity` is `local-owner`, `grant-file` or `external`:

- **`local-owner`:** the host admits the trusted local owner and issues it a session.
- **`grant-file`:** the host issues no local owner session and writes no owner credential. It admits only a launcher's [delegated grant](glossary.md#grant) within the maximum lifetime, including for embedded CLI and MCP calls.
- **`external`:** people sign in through [workforce sign-in](glossary.md#workforce-sign-in) with the OpenID Connect provider named in `workforce`, using the authorization code flow with PKCE. The provider's issuer must be on the origin bound to the `workforce-idp` destination. The host issues the local owner no session, and embedded calls need a launcher grant.

Under `external`, the host never falls back to the local owner. `showcase/examples/field-service/test/hardening.test.ts` covers the identity floors.

### Ingress and certificates

A TLS listener binds the policy's host name and fixed port with the site's certificate. With `mtls`, it admits only clients whose certificate chains to `clientCa`. With `tls`, any client on the network completes the handshake. A policy that sets `clientCa` on a `tls` listener is refused, because nothing would check it. Either way, every API call still needs a session token or a device credential.

Certificate paths resolve next to the policy file. The site issues and renews its own certificates, and the host only reads them. At startup it reads the listener certificate, the client CA and each destination's CA bundle, never the key. Startup refuses:

- a listener certificate outside its validity window;
- a CA bundle with no valid certificate;
- a file with no readable PEM certificate.

A certificate within 30 days of expiry is a warning. So is an expired certificate in a bundle that still holds a valid one. The posture monitor judges validity again on every check, so a certificate that expires while the host runs turns the `certificates` check to `fail`.

## Egress

### Egress guard

Outbound connections of the host and its plugins pass through the egress guard, except the reviewed exemptions in `scripts/boundary-rules.ts`:

- **Destination clients.** A fetch scoped to one destination allows only the bound scheme, host and port. It checks every redirect hop and the resolved addresses, applies the CA and pin settings, and caps response size and time.
- **Provider SDKs.** They get a fetch routed by origin, which explains each refusal.
- **TCP transports.** They get a scoped socket.
- **Child processes.** Declared children reach the network through a loopback CONNECT proxy. The proxy identifies each child by a per-process credential and tunnels only to its declared destinations.

A refusal is an `UNAVAILABLE` error, which is HTTP 503 and CLI exit 8, and the audit log records it as `egress.denied`. The guard records an allowed connection before it opens. With a fail-closed audit log, a connection that cannot be recorded does not open. `plugins/network/test/guard.test.ts` covers the redirect, address, cap and proxy checks.

`check:boundaries` fails when server code uses network, socket or process APIs directly instead of the guard. `scripts/boundary-rules.ts` lists each reviewed exemption with its reason, among them the harness launches in `packages/agents`. A stale exemption fails the check.

The desktop window lets its renderer reach only the local instance ([desktop](desktop.md)). The [telemetry plugin](../plugins/telemetry/README.md) exports through the guard to a collector on the same machine, and that collector holds any vendor credential ([architecture](architecture.md#telemetry)). The fleet agent connects only outbound, through its `fleet` destination ([hosting](hosting.md#fleet)).

### Generated rules

Generated rules cover what the guard cannot see: a child that ignores proxy settings, a dependency that opens its own socket, or a compromised process. Hand-written rules drift from the code, so `network export` renders them from the same declarations and policy. Every format denies by default, includes the policy digest, and lists any binding it could not enforce.

| Format | Enforces |
| --- | --- |
| `nftables` | Egress for the host's OS user, by address and port, with DNS only to the given resolvers. |
| `windows-firewall` | Program-scoped rules. Windows applies block rules first, so the export blocks the complement of what is allowed. |
| `systemd` | A hardened unit: allowed addresses only, read-only system, private devices and temp, no capabilities, a syscall filter. |
| `k8s-networkpolicy` | Egress and ingress for the pod. |
| `k8s-pod` | Non-root, read-only root filesystem, no capabilities, default seccomp. |
| `compose` | Container hardening only. Compose cannot filter by destination, and the file says so. |
| `json` | The neutral rule set, for other tools. |

The export does not apply the rules; applying them is a deployment step. The tests compare the exports with golden files in `plugins/network/test/golden`. No export has been loaded into a real firewall or cluster here.

### Agent tool sandboxes

The [execution host](glossary.md#execution-host) runs the tools an agent uses in Linux bubblewrap sandboxes. It starts each sandbox through the [process port](glossary.md#process-port), so the deployment policy binds and pins bubblewrap. Each sandbox has:

- new namespaces;
- a root that holds only the declared tools and named paths;
- a seccomp filter that denies mounting, namespace creation, ptrace and kernel loading;
- a network namespace with loopback only.

Two relays are the sandbox's only way out. One reaches the host API with a token bound to the run's grant. The other reaches the egress proxy for the destinations the sandbox declares. Revoking the token or reaching the grant's expiry stops the next call. macOS and Windows have no backend.

### Local models

The [model server plugin](../plugins/model-server/README.md) hashes the weights before every start. It refuses files that differ from the [model entry](glossary.md#model-entry), and a fine-tune without a passing activation for its exact digests. Its runs record the measured digests with `verified: true`, so an auditor can trace an approval request to the base weights, the adapter and the dataset. A harness for a model server run outside the host records the digests it was given as unverified. The [approval dataset](glossary.md#approval-dataset) export applies redaction before its digest, so only what the exporting caller may see leaves the host for training.

## Peer applications

The [peer link](glossary.md#peer-link) admits another application to the [peer API](glossary.md#peer-api) an application declares. Each threat and the control that meets it:

| Threat | Control |
| --- | --- |
| A stranger who reaches the listener enrolls | The enrollment route redeems only a one-use code, valid for ten minutes, with ten failed exchanges per minute for all callers together. |
| A peer calls beyond the peer API | The service principal's grant holds the peer API's service operations, or the narrower list the enrollment named. Its integration allowlist reads no journal events. |
| A peer acts as any person | A call on behalf of a person needs a [subject assertion](glossary.md#subject-assertion) signed by the key enrolled with the credential, and a [subject mapping](glossary.md#subject-mapping). No subject maps to a `peer:` or `device:` principal or to a reserved principal. |
| A peer does what the person may not | The mapped person's own policy applies within the peer API's on-behalf-of operations, and a person-only rule refuses the call. An assertion with `act: agent` is refused unless the application allows agents. |
| A captured assertion is replayed or moved | The assertion binds the audience, the request line and the body digest. It lives at most 120 seconds, and its `jti` is accepted once. |
| A peer opens a session as the person | A call on behalf of a person opens no browser session and no event stream. |
| A revoked peer or unmapped subject keeps calling | Every request resolves the credential and the mapping again, so a revocation or an unmapping applies to the next request. |
| The calling host leaks its credential | The credential and private key stay in the secret store, or without one in a 0600 file in a 0700 directory, outside state, receipts and the journal. The peer clients send them only to the target's destination, refuse redirects and drop caller-set `Authorization`, `Cookie` and `Agent-Native-Subject` headers. |
| The credential crosses the network in clear text | A peer destination is declared `authenticated`, so the site plugin refuses a plaintext binding to it off loopback. |
| A changed peer misreads input | The drift check blocks an operation whose schema digest differs from the one the peer serves, so its effects wait. |

`plugins/peer-link/test/security.test.ts` covers the controls on the called side, `test/link.test.ts` those on the calling side, and `test/tls.test.ts` a pair over TLS with a site CA.

These risks remain:

- The `jti` cache is in memory. An assertion captured within two minutes before a restart can be presented once more after it, still only with the peer's bearer credential.
- A stolen credential together with the private key can assert any mapped subject, within the peer API and that person's policy.
- The one-use code stays in the stored receipt of `peer.enrollment.create`, worthless once redeemed or expired.

## Audit log

The audit log records these events in one chain:

- commands, queries and denials, from every channel, including the dispatcher and inbound sync;
- outbox transitions;
- guard decisions and child processes;
- sessions, delegated grants and agent runs;
- OS requests and actions;
- host startup and posture checks.

`packages/contracts/src/audit.ts` lists the event kinds. Each event includes the caller's principal, workspace, run and [channel](glossary.md#channel), the operation ID, a safe reason code and correlation IDs. It includes an input digest and only the input fields the capability allows.

The composition's audit log port keeps no log. Once `plugins/audit` is composed, the log runs in the policy's audit mode, which defaults to fail-closed. A supplied policy therefore needs the audit plugin unless it sets `best-effort`. The file log chains events with SHA-256 across rotated segments and writes checkpoints. It syncs every append, keeps its files private to the owner, and allows one writer per directory. It lives in the workspace unless the `audit-log` setting moves it.

### Fail-closed ordering

A command's acceptance is recorded inside its transaction, after final authorization. If that record fails, nothing commits. A record written after the commit would allow commits that were never recorded. In fail-closed mode, a query whose record fails returns no data, and a connection whose record fails does not open.

If the process dies before the commit is recorded, startup resolves the open entry against the [receipts](glossary.md#receipt). A site can trade this for availability with `best-effort`, and every profile except `desktop-local` refuses that setting. `packages/runtime/test/audit.test.ts` covers the rollback, and `showcase/examples/field-service/test/security.test.ts` covers crash recovery.

### Attestation and forwarding

Before the first request, startup records the executable, catalog and policy digests and the policy's findings. An auditor can then match a running instance to its SBOM and security manifest. A built binary also records its build time and [best-before date](glossary.md#best-before-date).

`audit.forwardTo` sends events to a bound collector as RFC 5424 syslog. The forwarder sends after the local append, through the guard like any other connection. Without the network plugin the connection is refused, and the forwarder counts the failure.

## Compliance bundle

`bun run generate` writes these files for each application to `dist/reference/<id>/`, and the shared control catalog to `dist/reference/`. Nothing generated is committed. `bun run bundle create` writes the security manifest and the contract into each signed [site bundle](glossary.md#site-bundle).

| File | Contents |
| --- | --- |
| `security-manifest.json` | Each declared destination, device and process with its owner, and each operation whose effects leave the host. |
| `data-flows.md` | A diagram and tables of the same, with the data classes that go where. |
| `controls.json`, `controls.md` | Controls mapped to the frameworks listed below, each with tests, artifacts and event kinds as evidence. |

The security manifest's `summary.site` lists what pins the application to the site. The controls map to ISO/IEC 27001:2022 Annex A, NIST SP 800-53 Rev. 5, NIST CSF 2.0 and IEC 62443-4-2. The mappings are indicative. Certification still needs the organization's own scope and the licensed standard text.

`bun run bundle create` also writes `sbom.cdx.json` into each site bundle. It is CycloneDX 1.6, built from the lockfile at build time, with declared destinations as services with trust zones and data flows. No SBOM is committed.

## Checks

The verbs run offline, with no instance or workspace. Here `app` stands for the application's CLI:

```sh
app site check --site site-policy.json                # exit 2 on any error finding
app network export --site site-policy.json --format nftables --resolver 10.20.0.53
app audit verify --log /var/lib/app/audit             # exit 10 if the chain is damaged
app compliance report --log /var/lib/app/audit --site site-policy.json --format markdown   # exit 10 if failing
```

While the application runs, a posture monitor re-verifies the chain on an interval and on demand. It summarizes egress per destination and never probes the network. The `best-before` check warns from 30 days before the build's best-before date and never fails, so `compliance report` does not exit 10 for it. Auditors read posture, events and chain status through ordinary read-only queries and the Compliance screen. The screen polls every five seconds, so a denial appears within seconds.

Only listed auditors may read the audit log; at creation the workspace owner is the only one. A delegated grant must name the operation. A grant limited to resources must also name `audit:log`.

## Isolated operation

With no deployment policy, the application runs isolated:

- it listens on loopback only;
- outbox targets queue visibly;
- inference providers report a status of unavailable;
- the deterministic harness keeps working.

A site connected to a fleet keeps working while the fleet is unreachable ([hosting](hosting.md#fleet)).

`bun run test:isolated` fails on any non-loopback connection from the test process. `bun run test:sandbox` runs the compiled binary in an empty environment. It then checks the audit chain and that the binary attempted no egress.

## Limits

- The guard and the proxy are in-process controls. Real containment needs the exported rules applied, or an OS sandbox. The execution host provides one for agent tools, on Linux only.
- A process running as the workspace owner can read the workspace and the audit log. Chaining detects edits but cannot stop deletion of the newest entries; off-host forwarding covers that.
- Workforce sign-in supports OpenID Connect only, with no LDAP or SAML.
- The host checks certificates for expiry but never issues or rotates them.
- The peer link uses no mTLS client certificate and cannot rotate a peer's key.
- The isolated-test trap does not cover child processes.
- Devices are declared but not mediated. The systemd export needs explicit allowances for declared devices.

## References

- [Architecture](architecture.md)
- [Hosting](hosting.md)
- [Systems of record](systems-of-record.md)
- [Agents](agents.md)
- [Desktop](desktop.md)
- [Mobile](mobile.md)
- [Implementation status](implementation-status.md)
- [`showcase/examples/quality-inspection/site-policy.sandbox.json`](../showcase/examples/quality-inspection/site-policy.sandbox.json)
- [Site plugin's trust boundary](../plugins/site/README.md#trust-boundary)
- [Peer link's trust boundary](../plugins/peer-link/README.md#trust-boundary)
- [Systems of record](systems-of-record.md#exit-codes)
