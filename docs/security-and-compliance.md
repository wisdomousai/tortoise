# Security and compliance

Your app declares what it needs outside the process. A site's deployment policy allows some of it. The egress guard blocks the rest, and the audit log records everything in a hash chain.

Try it on the default app (field-service), from the repo root, after `bun run dev:web` has run once:

```sh
bun run cli site check --site apps/desktop/site-policy.json
bun run cli network export --site apps/desktop/site-policy.json --format json
bun run cli audit verify --log .workspace/audit
bun run cli compliance report --log .workspace/audit --site apps/desktop/site-policy.json --format markdown
```

You should see `{"ok":true,"profile":"desktop-local",...}` with `HOSTNAME_ONLY` warnings, a JSON rule set with `"defaultEgress": "deny"`, `{"ok":true,"segments":1,...,"problems":[]}`, and a "Security posture: field-service" report with a checks table.

## Controls and plugins

1. **Declare** what you need (destinations, folders, devices, processes).
2. **Bind** it in the site's deployment policy. Unbound means unreachable.
3. **Enforce** with the egress guard, plus exported firewall rules.
4. **Record** in the audit log.

| Plugin       | Does                                                       | CLI verb            |
| ------------ | ---------------------------------------------------------- | ------------------- |
| `site`       | Loads the deployment policy; enforces profile floors and identity | `site check`  |
| `network`    | Egress guard, proxy for child processes, TLS/mTLS ingress  | `network export`    |
| `audit`      | Hash-chained audit log, forwarding, crash recovery         | `audit verify`      |
| `compliance` | Auditor queries, posture monitor, Compliance screen        | `compliance report` |

Without `network`, nothing leaves the host. Startup refuses a policy setting that no composed plugin would enforce.

## Declarations

Declare each outside need as data. Real example from `plugins/audit/src/plugin-manifest.ts`:

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

Rules (`packages/contracts/src/requirements.ts`):

- Name a host only for a fixed vendor endpoint. The policy names site systems.
- Every target needs a declared destination, folder or process. A destination that delivers outbox effects must use `offline: 'queue'`.
- Code reaches a folder by ID through the folder port, never by path.
- A capability lists the input fields safe to log in plain text; the audit log stores the rest as a digest.

## Deployment policy

The policy is one JSON file per site. Pass it with `--site-policy` or `TORTOISE_SITE_POLICY`. Check it with `app site check --site <file>` (exit 2 on errors).

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

| Key                  | Use                                                                   |
| -------------------- | --------------------------------------------------------------------- |
| `addresses`          | CIDRs the host may resolve to. Without them you get `HOSTNAME_ONLY` and no firewall rule. |
| `ca`, `certificatePins` | Custom trust for one destination.                                  |
| `timeoutMs`          | Per-destination timeout (default 30 s).                               |
| `maxResponseBytes`   | Per-destination response cap (default 32 MiB).                        |
| `folders`            | Folder ID → absolute directory, or disabled with a reason.            |
| `mode: connected`    | You must bind or disable every required destination.                 |

A real file: [`showcase/examples/quality-inspection/site-policy.sandbox.json`](../showcase/examples/quality-inspection/site-policy.sandbox.json).

### Hardening profiles

Each profile is a floor; startup refuses a weaker policy (`plugins/site/src/policy/floors.ts`).

| Floor                   | desktop-local      | site-hub, sandbox                        | zero-trust                   |
| ----------------------- | ------------------ | ---------------------------------------- | ---------------------------- |
| Plain HTTP off the host | if declared        | refused                                  | refused; TLS with CA or pins |
| Credentials off host    | TLS                | TLS                                      | TLS with CA or pins          |
| Ingress                 | loopback           | loopback, TLS, mTLS                      | loopback, mTLS               |
| Identity                | any                | site-hub: any; sandbox: grant or external | external                    |
| Audit log               | fail-closed or best-effort | fail-closed                      | fail-closed and forwarded    |
| Delegated grants        | `maxTtlSeconds` if set | `maxTtlSeconds` required             | ≤ 1 hour                     |

Use `site-hub` for a hub that paired phones reach (see [device-link](../plugins/device-link/README.md)).

### Identity

| `identity`    | Who gets in                                                                   |
| ------------- | ----------------------------------------------------------------------------- |
| `local-owner` | The local owner gets a session.                                               |
| `grant-file`  | Only a launcher's delegated grant. No owner session.     |
| `external`    | People sign in through OpenID Connect (workforce sign-in). Never falls back to the owner. |

### Ingress and certificates

`tls` serves the site's certificate to anyone; `mtls` also requires a client certificate from `clientCa`. Every API call still needs a session or device credential. The host reads certificates but never issues or renews them. Expired certificates refuse startup; within 30 days of expiry you get a warning.

## Egress

### Egress guard

All outbound traffic from the host goes through the guard. It allows only bound scheme, host, port and addresses, checks every redirect, and caps size and time. Child processes go through a loopback proxy that only reaches their declared destinations. A refusal returns `UNAVAILABLE` (HTTP 503, CLI exit 8) and logs `egress.denied`.

`bun run check:boundaries` fails if server code opens sockets, fetches or spawns processes directly. `scripts/boundary-rules.ts` lists the exemptions.

### Generated rules

`app network export --format <f>` renders OS rules from the same policy. All deny by default. You apply them yourself.

| Format              | Output                                         |
| ------------------- | ---------------------------------------------- |
| `nftables`          | Egress for the host user, by address and port. |
| `windows-firewall`  | Program-scoped rules.                          |
| `systemd`           | A hardened unit.                               |
| `k8s-networkpolicy`, `k8s-pod` | Pod egress/ingress; pod hardening.  |
| `compose`           | Container hardening only.                      |
| `json`              | Neutral rule set.                              |

Golden files: `plugins/network/test/golden`. None has run on a real firewall here.

### Agent tool sandboxes

The execution host runs agent tools in bubblewrap sandboxes: new namespaces, only declared tools on disk, seccomp, loopback-only network. Two relays lead out: the host API (token bound to the run's grant) and the egress proxy. Linux only.

### Local models

The [model server](../plugins/model-server/README.md) hashes weights before each start and refuses files that don't match the model entry.

## Peer applications

The peer link lets another app call your peer API.

| Threat                         | Control                                                                 |
| ------------------------------ | ----------------------------------------------------------------------- |
| A stranger enrolls             | One-use code, 10 min, 10 failed tries per minute.                       |
| Peer calls beyond the API      | Its grant holds only the peer API's operations.                          |
| Peer acts as anyone            | Needs a signed subject assertion and a subject mapping. |
| Peer does more than the person may | The mapped person's own policy applies.                             |
| Assertion replayed             | Binds to audience, request and body; 120 s; one use.                    |
| Revoked peer keeps calling     | The host resolves credential and mapping on every request.              |
| Credential sent in clear       | Peer destinations are `authenticated`; the host refuses plaintext off loopback. |

Tests: `plugins/peer-link/test/security.test.ts`, `link.test.ts`, `tls.test.ts`.

## Audit log

The audit log records commands, queries, denials, outbox transitions, egress decisions, child processes, sessions, grants, agent runs, OS actions and startup. Event kinds: `packages/contracts/src/audit.ts`. It stores inputs as a digest plus the allowed fields.

The log lives in `.workspace/audit/` (SHA-256 chain, synced on every append, one writer).

### Fail-closed ordering

The audit plugin writes the record inside the command's transaction. If the record fails, nothing commits. A query whose record fails returns nothing; a connection whose record fails doesn't open. `best-effort` trades this for availability; only `desktop-local` allows it.

### Attestation and forwarding

At startup the log records the executable, catalog and policy digests. `audit.forwardTo` sends events as RFC 5424 syslog to a bound collector.

## Compliance bundle

`bun run generate` writes, per app, to `dist/reference/<id>/`:

| File                           | Contents                                                       |
| ------------------------------ | -------------------------------------------------------------- |
| `security-manifest.json`       | Every destination, device and process, and every operation that leaves the host. |
| `data-flows.md`                | The same as a diagram and tables.                              |
| `controls.json`, `controls.md` | Controls mapped to ISO 27001, NIST 800-53, NIST CSF, IEC 62443-4-2 (indicative), with test evidence. |

`bun run bundle create` adds `sbom.cdx.json` (CycloneDX 1.6) to each site bundle.

## Checks

| Command                                                         | Fails with                      |
| --------------------------------------------------------------- | ------------------------------- |
| `app site check --site <file>`                                  | exit 2 on any error finding     |
| `app network export --site <file> --format nftables --resolver 10.20.0.53` | exit 2 on policy errors |
| `app audit verify --log <dir>`                                  | exit 10 if the chain is damaged |
| `app compliance report --log <dir> --site <file> --format markdown` | exit 10 if posture fails    |

From the repo, `app` is `bun run cli`. While running, the posture monitor re-checks the chain; auditors see it on the Compliance screen. Only listed auditors (at first, the owner) may read the log.

## Isolated operation

Without a policy, the app listens on loopback only, outbox targets queue, and model providers report unavailable. `bun run test:isolated` fails on any non-loopback connection. `bun run test:sandbox` runs the compiled binary in an empty environment and checks it made no egress.

## Limits

- The guard is in-process. Real containment needs the exported rules or an OS sandbox.
- The workspace owner's OS user can read and delete the log. Forward it off the host.
- Workforce sign-in is OpenID Connect only.
- The isolated-test trap doesn't cover child processes.
- Apps declare devices; the host does not mediate access to them.
