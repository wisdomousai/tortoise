# Security and compliance

Security controls are supplied by the host and its composed plugins. An application's requirements declare the external resources its operations use. A deployment policy binds those declarations to the installation. The plugins enforcing the policy must be present before the host can accept work.

The runtime's application authorization is specified in [Authorization](authorization.md). Deployment configuration controls the environment and credentials through which that runtime is reached.

## Controls and plugins

The deployment plugin loads policy and checks its hardening requirements. The network plugin supplies guarded outbound connections and configured ingress. The audit plugin supplies the persistent event log. The compliance plugin exposes control findings and monitors the configured log.

Startup rejects settings that no composed plugin declares. Omitting the network provider leaves its port refusing outbound requests. Omitting persistent audit leaves no persistent audit log; the runtime does not create one independently of the configured provider.

## Declarations

Requirements are browser-safe data declared by modules and host components. A network requirement states its destination identifier and intended scope. It also declares the protocol and the data classes sent there. Availability and offline behavior determine whether a missing resource prevents operation or leaves work queued.

Fixed vendor endpoints can declare their hostname. Deployment-specific addresses belong in policy. A target must be associated with a declared external resource. A destination used for outbox delivery requires `offline: 'queue'`.

Folder access uses the folder port and a declared folder identifier. The policy resolves that identifier to an absolute path. A capability's `audit.fields` declaration identifies input fields allowed in plaintext audit data. Other input values contribute to the digest; the digest does not make low-entropy sensitive input safe to publish. Requirement validation is implemented in `packages/contracts/src/requirements.ts`.

## Deployment policy

Pass the policy file with `--deployment-policy` or `TORTOISE_DEPLOYMENT_POLICY`. The policy selects a hardening profile and binds the declared destinations. It can disable a destination with a reason. In connected mode, required destinations must be bound or explicitly disabled.

A destination binding's `addresses` limits DNS results to the declared CIDRs. A binding without addresses produces `HOSTNAME_ONLY` and cannot yield an address-based firewall rule. `ca` and `certificatePins` configure destination trust. The default timeout is 30 seconds; the default response limit is 32 MiB. A binding can override these with `timeoutMs` and `maxResponseBytes`.

Folder bindings resolve declared identifiers to absolute directories or disable them explicitly. Process bindings identify an executable and its allowed arguments and environment. [Hardware drivers](hardware-drivers.md#process-binding) describes driver processes.

### Hardening profiles

A profile sets minimum policy requirements. Startup rejects a policy below its floor, as implemented in `plugins/deployment/src/policy/floors.ts`.

| Constraint | `desktop-local` | `hub` / `sandbox` | `zero-trust` |
| --- | --- | --- | --- |
| Plain HTTP off host | Permitted when declared | Refused | Refused |
| Off-host credentials | TLS required | TLS required | TLS with CA or pins |
| Ingress | Loopback | Loopback, TLS or mTLS | Loopback or mTLS |
| Identity | Any declared mode | Hub permits any; sandbox requires grant or external | External |
| Audit | Fail-closed or best-effort | Fail-closed | Fail-closed and forwarded |
| Delegated grants | TTL limit when configured | TTL limit required | TTL at most one hour |

The `hub` profile supports ingress for paired devices. The `zero-trust` profile requires destination trust through a CA or pins in addition to its TLS floor.

### Identity

`local-user` permits issuance of the local user's session. `grant-file` requires a launcher's delegated grant and issues no local-user session. `external` uses configured OpenID Connect workforce sign-in. Failed external identity configuration does not fall back to the local user.

### Ingress and certificates

TLS ingress presents the configured server certificate. mTLS additionally requires a client certificate trusted by `clientCa`. API calls still need the applicable session or device credential. The host reads certificates supplied by deployment administration and does not issue or renew them. Expired certificates refuse startup. Certificates within 30 days of expiry produce a warning.

## Network access

### Network guard

Server code is required to reach the network through the host port. The network plugin checks requests against the destination's bound scheme and host, including its port and permitted addresses. It checks redirects and applies configured time and size limits. Its child-process proxy restricts proxy traffic to the process's declared destinations.

A refused guarded connection returns `UNAVAILABLE` and records `network.denied` when an audit provider is configured. The HTTP error status is 503; the CLI maps this error to exit 8. `bun run check:boundaries` detects forbidden direct network and process APIs outside the reviewed exceptions in `scripts/boundary-rules.ts`.

The guard operates in the host process. It does not contain another process that opens its own raw socket. Apply OS enforcement when that isolation is required.

### Generated rules

`app network export --format <format>` renders policy-derived OS configuration. The command does not apply that configuration. Address-based enforcement requires the corresponding policy addresses.

| Format | Configuration produced |
| --- | --- |
| `nftables` | Outbound rules for the host user |
| `windows-firewall` | Program-scoped rules |
| `systemd` | Hardened service unit |
| `k8s-networkpolicy` | Pod network policy |
| `k8s-pod` | Pod hardening |
| `compose` | Container hardening |
| `json` | Neutral rule set |

Golden output is stored in `plugins/network/test/golden`. Recorded live firewall evidence and its limits belong in [Implementation status](implementation-status.md#security-and-compliance).

### Agent tool sandboxes

The execution-host plugin can run declared agent tools in Linux bubblewrap sandboxes. Its namespaces restrict the available filesystem, and seccomp limits system calls. The sandbox's external access passes through relays for the granted host API and network proxy. This implementation requires Linux; the host's ordinary in-process network guard does not provide the same process isolation.

### Local models

The model-server plugin verifies the declared weight digests before starting its process. A mismatch refuses startup. The deployment still needs an allowed process binding and loopback inference destination, as specified by the [model-server package](../plugins/model-server/README.md).

## Peer applications

Peer enrollment requires a one-use code. Its default lifetime is ten minutes, and the endpoint allows ten failed attempts per minute. The issued peer grant is limited to the declared peer API.

Calling on behalf of a person requires a signed subject assertion and an administrator's subject mapping. The mapped person's current policy applies to the operation. Assertions bind the audience and request body, expire after 120 seconds and can be used once. Credential and subject mappings are resolved on each request, so revocation takes effect on the next call.

Peer destinations are authenticated. Off-loopback plaintext connections are refused. [Systems of record](systems-of-record.md#peer-applications) explains target composition; `plugins/peer-link/test/security.test.ts` covers the security boundary.

## Audit log

When configured, the audit provider records runtime events defined in `packages/contracts/src/audit.ts`. Input records include the input digest and the fields the capability permits in plaintext. The default persistent location is `.workspace/audit/`. The event log has a SHA-256 chain and a single writer; each append is synced.

### Fail-closed ordering

A command appends `command.accepted` inside the storage transaction after its final authorization check. If that required append fails, the transaction aborts with `UNAVAILABLE`. Once storage commits, the runtime appends `command.committed` and related effect events. A failure of this later append cannot undo the committed transaction.

A crash between these appends leaves an accepted event without a recorded outcome. Startup recovery checks retained command and journal evidence to resolve it. The file log and workspace database do not share one storage transaction.

In required mode, a query's audit append must succeed before the runtime returns the data. Guarded connections likewise require the applicable audit step before opening. `best-effort` permits an operation to proceed after its audit append fails; only the `desktop-local` profile accepts that policy mode.

### Attestation and forwarding

Startup records executable and catalog digests with the policy digest. `audit.forwardTo` forwards events as RFC 5424 syslog to the bound collector. The local OS user can modify or delete local files; off-host forwarding is needed for independently retained evidence.

## Compliance bundle

Catalog generation writes the security manifest to `dist/reference/<id>/security-manifest.json`. It identifies external requirements and the operations that use them. `data-flows.md` renders those declarations. `controls.json` and `controls.md` associate controls with their test references and standard mappings.

The mappings include ISO 27001 and NIST controls, with indicative IEC 62443-4-2 mappings. Generated mappings do not establish a deployment's certification. Bundle creation adds its CycloneDX SBOM. Generated references remain outside version control.

## Checks

Use the application's CLI from its repository root. In the framework checkout, `app` means `bun run cli`.

| Command | Failure outcome |
| --- | --- |
| `app policy check --policy <file>` | Exit 2 on error findings |
| `app network export --policy <file> --format nftables` | Exit 2 on policy errors |
| `app audit verify --log <directory>` | Exit 10 on a damaged chain |
| `app compliance report --log <directory> --policy <file> --format markdown` | Exit 10 on failing compliance status |

The compliance monitor checks the configured chain while the host runs. Its queries require auditor access. The initial auditor is the local user unless the application configures otherwise.

## Isolated operation

Without deployment bindings, the local host listens on loopback and guarded external dependencies remain unavailable. Outbox effects wait for a usable target. `bun run test:isolated` traps non-loopback connections made in the test process. Child-process traffic is outside that trap. `bun run test:sandbox` checks the compiled application in an empty environment.

## Limits

Workforce sign-in currently supports OpenID Connect. Device declarations describe access but the host does not mediate every device API. The host guard and exported rules enforce different parts of the process boundary; deployment administration must configure the OS controls it needs. Current deployment evidence is recorded in [Implementation status](implementation-status.md).
