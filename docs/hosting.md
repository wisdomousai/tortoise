# Deployment and operation

A deployment binds an application's declared requirements to the environment that runs it. The Bun host normally keeps its workspace in a local directory. A hosted instance uses Postgres for workspace storage and takes a database lease before accepting work. The application retains the same capability contracts, but the platform must supply the facilities its requirements declare.

## Local workspace

A local instance owns its workspace directory while open. Stop the serving host before opening that workspace with an embedded maintenance command. `backup`, `restore` and `migrate` operate local storage; they cannot operate a hosted workspace through its local directory.

The deployment policy binds declared destinations and local resources. Its identity and ingress configuration determine how callers receive sessions. [Security and compliance](security-and-compliance.md) specifies the enforcement rules. The desktop and mobile hosts have platform-specific ownership behavior documented in their host guides.

## Hosted instance

`serve --hosted-workspace <name>` selects the hosted platform in `packages/host/src/platform/hosted.ts`. Configure `TORTOISE_DATABASE_URL` from the deployment's secret store with a Postgres database in which the host can create its tables. Instances addressing the same workspace must use the same name.

From the application repository root:

```sh
bun run cli serve --workspace ./instance --hosted-workspace <name> --port 4317
```

For development from an application directory, the equivalent launcher is `bun ../../scripts/dev-example.ts --port 4317 --hosted-workspace <name>`. The hosted platform requires Postgres 15 or newer. It has no managed-cloud-specific entrypoint.

Configure TLS ingress and `identity: external` in the deployment policy. The `workforce` setting identifies the OpenID Connect provider, and `workforce-idp` binds its origin. Hosted callers use workforce sign-in. The platform does not issue the local-user browser session used by a local deployment.

Reach a hosted instance in attached mode. The local-only commands `backup`, `restore`, `migrate`, `sync` and `drain`, as well as `--embedded`, do not open its Postgres workspace. Back up the database through its own tools and include the instance's local files in the deployment's backup procedure.

### Workspace lease and fence

The instance acquires a lease using the database clock. A held, unexpired lease causes a competing instance to return `CONFLICT` and exit with code 5. The default lease lifetime is 30 seconds and renewal occurs every ten seconds.

Each acquisition increments a fencing token. Every Postgres commit checks that token inside its transaction under a workspace advisory lock. An instance that resumes after another has taken its lease fails its next commit before accessing the workspace state. A renewal that detects lost ownership logs `lease-lost` and exits with code 1. Process supervision should restart that failure; a clean shutdown releases the lease.

The lease implementation is in `packages/adapters/src/postgres-lease.ts`. Storage and lease conformance run without a server through PGlite:

```sh
bun test packages/testing/test/storage.test.ts packages/testing/test/postgres-lease.test.ts packages/host/test/hosted-platform.test.ts
```

Setting `STORAGE_POSTGRES_URL` to an explicitly configured disposable database enables checks against a Postgres server. Fixture success does not establish a deployed database's availability or backup behavior.

### Instance layout

One serving instance addresses one workspace. Multiple workspaces require separate instances and routing. Blobs are stored in `workspace_blobs`. When a prior release left a blob locally, a read copies it into the database.

The `--workspace` directory still contains run history and plugin files, including workforce sessions and the configured audit log. Keep this directory on a volume that follows the instance. Sessions are stored by token digest in `workforce-sessions.sqlite`, so restarting with that directory preserves unexpired sessions. A takeover without it requires people to sign in again.

Review the generated security manifest before moving a locally bound application to a hosted server. The host does not currently refuse every local-scoped requirement at startup. A local device, folder or workstation process remains tied to the machine that supplies it.

## Fleet

A fleet connection is optional. The fleet-agent plugin makes outbound calls through the declared `fleet` destination and does not require inbound access to the instance. Losing that connection leaves local application execution available.

### Fleet agent

The plugin's default cycle runs each minute. It reports instance health and outbox counts without effect payloads, then forwards the audit events missing at the fleet in batches of 100. When assigned a release, it downloads the files and checks them against the signed manifest and configured trust keys before staging them. Staging does not activate the release. Activation requires `app install`.

Compose the fleet-agent manifest and server plugin after its deployment, network and audit dependencies. Bind `destinations.fleet` to the fleet's HTTPS origin and `folders['fleet-releases']` to a writable directory. Obtain a device-link enrollment code from the configured fleet service and supply it on initial startup through `--fleet-enrollment-code` or `TORTOISE_FLEET_ENROLLMENT_CODE`.

Set `TORTOISE_FLEET_TRUST` to the publisher's public key file to permit staging. Activate a staged release with `app install <release-directory> --trust <public-key-file>`. `createFleetAgentPlugin({ intervalMs, relayMs })` configures polling intervals.

A failed cycle sets `lastError` in the fleet-agent service status and retries on the next cycle. The plugin keeps its credential in the platform secret store when available; otherwise it uses `<workspace>/fleet-agent/credential` with mode 0600. The plugin writes no application records. Its protocol implementation is tested by `bun test plugins/fleet-agent`.

### Relay

The relay is disabled by default. `TORTOISE_FLEET_RELAY=on` enables polling, which defaults to every two seconds. It forwards a single request at a time to the instance's `/api/v1/` routes with a body limit of 1 MiB. Event streams are unsupported.

Relayed requests omit cookies and responses omit `set-cookie`; redirects are not followed. Capability access still requires a session issued by the instance. The fleet credential is refused as that session. The fleet-side relay requires a person, so an agent run cannot use it to reach an instance.

### Fleet protocol

`fleetInstanceModule` defines the interface used by enrolled instances. Device-link enrollment issues the `device:<id>` identity, and its requests are scoped to that instance.

| Capability | Kind | Protocol responsibility |
| --- | --- | --- |
| `fleet.instance.report` | Command | Record health |
| `fleet.instance.desired` | Query | Return the assigned release |
| `fleet.audit.cursor` | Query | Return the position of the fleet's audit copy |
| `fleet.audit.ingest` | Command | Import subsequent events |
| `fleet.relay.claim` | Command | Claim a queued request |
| `fleet.relay.respond` | Command | Record its response |

A release uses the signed bundle manifest and signature from `@tortoise/bundle`. Each file is identified by its SHA-256 blob reference. The fleet-agent protocol does not prescribe a fleet application's UI roles or health thresholds.

## Shelf life and best-before date

A manifest can declare shelf life as a whole number of days. A production build stamps its build time, and the best-before date is that time plus the shelf life in UTC. A source launch has no build stamp. A manifest without shelf life produces no best-before date. Mobile builds currently have no stamp.

The generated application entry stamps CLI builds and desktop sidecars. Bundle creation uses the same timestamp for the binary and bundle, then signs the date in `bundle.json`. Changing the date invalidates verification. A replacement build receives its own timestamp.

The serving host includes build metadata in its `listening` record and returns it to a session from `GET /api/v1/build`. The web frame displays the date and a notice after it passes. A configured audit log records it in `config.loaded`; verified release status and fleet health expose it as well.

The compliance `best-before` check warns from 30 days before the date. It reports `info` when there is no date. Passing the date does not stop commands or prevent installation. The date supplies an operational warning.

## What decommissioning removes

Uninstalling removes the installed release and can purge its data directory. An empty outbox establishes that no unresolved delivery remains there. It does not establish that every local record or attachment has an external copy. Review retention requirements and copy the data that must survive removal.

`app uninstall --purge` verifies the installed release against `--trust` and invokes that release's own `drain` command. This lets the installed code interpret its own effect types. That binary runs with the installer's rights. With `--apply`, the service stops before draining. Without it, a serving host still owns the workspace and embedded drain refuses access.

Drain counts pending effects, held effects and acknowledged deliveries awaiting a decision. Any unresolved count blocks purge with `CONFLICT` and leaves files in place. `--discard-undelivered` explicitly overrides this check and reports the deleted counts. The refusal and override are covered in `plugins/deployment/test/install.test.ts`.

## Decommissioning procedure

Resolve held effects through the application's reconciliation interface while it is running. Stop the service before opening its local workspace with drain. In a systemd installation the command is `systemctl stop tortoise-<app>.service`.

Run the installed application's CLI against its workspace and deployment policy:

```sh
app drain --workspace /var/lib/tortoise/<app>/workspace --deployment-policy /etc/tortoise/<app>/deployment-policy.json --audit-log /var/lib/tortoise/<app>/audit
```

Retain the workspace while drain exits with code 75. Confirm the required backup before running `app uninstall --purge --trust <public-key-file> --apply`. Revoke enrollment at the fleet and peers before removing their instance records, so the retired instance cannot reconnect. Remove the external accounts and credentials assigned to this installation.

A desktop workspace lives under Electron's `userData`. Close the window before draining or copying it. The desktop uninstaller does not remove that workspace. A paired phone must deliver the records required at its hub before its device credential is revoked and the app is uninstalled. OS removal then deletes the local sandbox.

A hosted instance delivers while serving. Verify its unresolved delivery through the running host before stopping it. Hosted removal and backups use database administration; the local purge command cannot remove a hosted workspace. Also retain its local run history and audit files where required.

A list's CSV export omits history and attachments. It cannot replace a workspace backup when those records must survive. The framework keeps no application ownership or renewal register.

The [deployment skill](../plugins/deployment/skills/deploy-an-application/SKILL.md) describes bundle preparation. Use the [decommissioning skill](../plugins/deployment/skills/decommission-an-application/SKILL.md) for removal. Known deployment gaps and dated runs are recorded in [Implementation status](implementation-status.md).
