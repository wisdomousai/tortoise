# Hosting

An [instance](glossary.md#instance) can run on a server, with its [workspace](glossary.md#workspace) in Postgres under a lease, and [sites](glossary.md#site) can report to a fleet through enrollment, reports, releases and a relay.

## Concepts

Terms: [hosted instance](glossary.md#hosted-instance), [workspace lease](glossary.md#workspace-lease) and [fleet](glossary.md#fleet).

## Hosted instance

`serve --hosted-workspace` starts the [host](glossary.md#host) on the hosted [host platform](glossary.md#host-platform) (`packages/host/src/platform/hosted.ts`). The platform keeps the workspace in a shared Postgres database and makes ownership a workspace lease there. Contracts and handlers do not change. Managed cloud hosting is out of scope: the platform runs on any server with Postgres and targets no provider. No Cloudflare Durable Object host exists: the host uses Bun APIs and has no Workers entry.

### Workspace lease and fence

An instance takes the workspace's lease when it is free or expired. Each new holder's fence is one larger than the last holder's. While another holder's lease is live, a second instance is refused with `CONFLICT`. The lease lasts 30 seconds without a renewal, and the instance renews it every third of that time. Expiry uses the database's clock, so hosts with skewed clocks agree on it.

Every commit checks the fence inside its own transaction. The Postgres [storage](glossary.md#storage) adapter first takes a transaction-scoped advisory lock on the workspace key, so commits to one workspace run one at a time across every connection. It then checks the fence, and only then whether another host committed since its cached snapshot. The fence check takes a share lock on the lease row, so a takeover waits for a commit in progress.

A paused or partitioned instance can wake after a takeover and still reach the database. Its next commit fails before it reads or writes, because its fence is no longer current (`packages/adapters/src/postgres-lease.ts`). `packages/testing/test/postgres-lease.test.ts` races two hosts for one lease, renews and releases a lease, and fences the old holder after a takeover.

When a renewal finds the lease gone, the host logs a `lease-lost` JSON record on stderr and exits with code 1. A clean shutdown releases the lease, so the next instance need not wait for its expiry. In `packages/host/test/hosted-platform.test.ts`, one of two instances on one PGlite database serves and the other is refused. A renewal keeps the lease past its first expiry, and after a close the next instance starts from the committed state.

### Instance layout

One instance serves one workspace, because the [kernel](glossary.md#composition)'s instance, its plugins and their ports are per workspace. Several workspaces run one instance each, and a router sends each workspace's requests to its instance.

The instance also takes the OS lock on its local directory (`--workspace`). That directory still holds [blobs](glossary.md#blob), agent run history, the [audit log](glossary.md#audit-log) and the plugins' local files. Put it on a volume that follows the instance, or a takeover on another machine starts without those files.

A site-scoped destination, a device, an exchange folder or a station process ties an application to a site, so such an application does not belong on a hosted instance. Nothing refuses it at startup, because the hosted platform offers everything the Bun platform offers. The generated security manifest (`bun run generate`) lists every [requirement](glossary.md#requirement-declaration) the application declares.

### Instance setup

1. Provide a Postgres 15 or newer database the instance can create tables in.
2. Put the database URL, with its credentials, in `AGENT_NATIVE_DATABASE_URL` from the deployment's secret store. The host reads the URL only from this variable, so the credentials stay out of the process list and out of the deployment policy.
3. Start the instance. `<name>` is the workspace's key in the database, and every instance of one workspace uses the same key:

   ```sh
   bun run cli serve --workspace ./instance --hosted-workspace <name> --port 4317
   ```

4. Supervise the instance and restart it on exit code 1. A restarted instance exits with code 5 while another instance holds the lease (see [exit codes](systems-of-record.md#exit-codes)).
5. In the [deployment policy](glossary.md#deployment-policy), set `ingress.listen` to `tls` with the public certificate and its key.
6. In the same policy, set `identity: external`, name the OpenID Connect provider in `workforce`, and bind the `workforce-idp` destination to the provider's origin.
7. Back up the database with its own tools, such as `pg_dump` or point-in-time recovery.

People then sign in through [workforce sign-in](glossary.md#workforce-sign-in), and no local owner session exists. Workforce sessions live in the instance's memory, so a restart or a takeover signs everyone out.

The CLI's backup, restore, migrate, sync and drain verbs and any embedded call open a local workspace only. A hosted instance is reached in [attached mode](glossary.md#attached-mode).

A Postgres-compatible database can reuse the Postgres adapter with its own driver. The first command below runs the hosted tests on PGlite. The second runs the conformance and lease cases against the server the URL names, each case under its own workspace scope.

```sh
bun test packages/testing/test/storage.test.ts packages/testing/test/postgres-lease.test.ts packages/host/test/hosted-platform.test.ts
STORAGE_POSTGRES_URL=postgres://user:password@localhost:5432/scratch bun test packages/testing/test/storage.test.ts packages/testing/test/postgres-lease.test.ts
```

## Fleet

The fleet agent [host plugin](glossary.md#host-plugin) (`plugins/fleet-agent`) connects outbound only, through the network port's `fleet` destination, so the site needs no inbound rule.

### Fleet protocol

The protocol is one module, `fleetSiteModule`. The fleet enrolls each site through the [device link](glossary.md#device-link) plugin. Each site then calls the protocol as its own [principal](glossary.md#principal) `device:<id>`, and the fleet answers only about that site. The protocol has these [capabilities](glossary.md#capability):

| Capability | Kind | What the site does with it |
| --- | --- | --- |
| `fleet.site.report` | command | Sends its application, instance, [outbox](glossary.md#outbox) counts by target, audit head, staged release and [best-before date](glossary.md#best-before-date). |
| `fleet.site.desired` | query | Reads the release it should run. |
| `fleet.audit.cursor` | query | Asks where the fleet's copy of its audit log ends. |
| `fleet.audit.ingest` | command | Sends the events after that point as the JSON lines of its local log, 100 at a time. |
| `fleet.relay.take` | command | Takes the oldest remote-access request waiting for it. |
| `fleet.relay.answer` | command | Returns the site's response to that request. |

A release is the signed bundle manifest and signature from `packages/bundle`. Each file is the fleet blob `sha256:<file sha256>`.

### Fleet agent

On a serving host, the first cycle exchanges the one-use enrollment code for a fleet credential. A cycle then runs every minute. Each cycle reports health, forwards the audit events the fleet lacks and stages the assigned release. With the relay on, the plugin also polls for remote-access requests every two seconds. The plugin's service at `services['fleet-agent']` reports its status, runs a cycle on demand and forwards one waiting relay request.

The plugin writes nothing to the workspace. A failed cycle records its reason as `lastError` in the status, and the next cycle tries again. The site keeps committing and delivering while the fleet is unreachable. Cycles run one at a time, and only one enrollment runs at once, because a code works once.

A report holds [effect](glossary.md#effect) counts per target and no effect payloads. The plugin reads the outbox with the host's trusted identity, and only the counts leave the site.

Audit forwarding keeps no state on the site. The fleet says where its copy ends, so after a lost reply or a restart the site sends the same events again. Events leave unchanged, so the fleet can check the hash chain.

The plugin verifies a release before it appears in the releases folder. Each file is checked against the signed manifest as it arrives. The whole bundle is then verified against the `fleet-trust` keys before the temporary directory is renamed into the folder. Staging fetches each file whole and does not resume a download. Activation stays with the operator's site install, and the instance never replaces itself.

The fleet credential goes only to the fleet. The network port's `fleet` client resolves every path against the bound origin and refuses redirects. The plugin keeps the credential in the platform's secret store when the platform has one, and otherwise in `<workspace>/fleet-agent/credential` with mode 0600. The credential is not rotated, so a fleet that loses one re-enrolls the site with a new code.

`plugins/fleet-agent/test/fleet-agent.test.ts` runs a fixture fleet and a site on loopback. It covers enrollment, a site with no code, reports without payloads, lost replies, an unreachable fleet, a tampered release and the relay's session check. Its upgrade test stages version 2 from the fleet and installs it over version 1 with two effects pending. The workspace migrates before version 2 becomes active, and the effects keep contract version 1 while version 2 queues its own.

### Relay

The relay forwards a remote-access request to the host's own address, under `/api/v1/` only. It passes an allow-list of headers each way: cookies never go in, and `set-cookie` never comes out. The relay adds no credential and never follows a redirect. It polls the fleet instead of holding a stream open, forwards one request at a time with bodies up to 1 MiB, and carries no event streams.

A relayed request reaches a capability only with a [session](glossary.md#session) the site issued, for example through workforce sign-in. The site's identity port and policy check that session like any other caller's. The site refuses the fleet credential as a session, and the fleet agent test gets 403 for a request carrying it. `scripts/boundary-rules.ts` lists the relay as a reviewed exemption from the [egress guard](glossary.md#egress-guard), because its only target is the host itself.

### Fleet application

It keeps site records, release channels, forwarded audit events and relay requests, and has a health screen. It has no outbox target and needs nothing from a site, so it can run as a hosted instance.

Only workspace members pass the fleet's caller gate. Operators update sites, publish, assign and relay, and viewers read. Device link lets only the local owner create enrollments. An enrolled site is an integration lane that may call only the protocol and read only the release its channel assigns, so it can fetch no other blob. Relaying needs a person, so an agent run cannot reach a site through the fleet.

The fleet checks that a release's manifest is a bundle manifest and that the uploaded blobs are exactly its files, by digest and size. Each site checks the signature against its own trusted keys before staging, and the fleet does not judge it. A compromised fleet can withhold releases but cannot install one.

Each forwarded audit event must carry the next sequence number, link to the hash of the event before it, and match its own hash. The first event that fails stops collection for that site and records the reason, which the health screen shows. No capability resumes collection from the site's current head, so a broken chain stays broken. The fleet keeps the newest 1,000 events per site, and the site's own log keeps them all.

The health screen lists sites in any of these states:

- no report for 15 minutes;
- [held effects](systems-of-record.md#held-effects);
- a broken audit chain;
- audit forwarding more than 1,000 events behind;
- a staged release other than their channel's release;
- a build past its best-before date.

Its thresholds are constants in `examples/fleet/handlers/sites.ts`.

`site.remove` deletes a decommissioned site's record and its relay requests and keeps the audit events it forwarded. It needs an operator who is a person. A site whose device link still works adds itself again with its next report, so the device is revoked first.

A relay request's headers and body are stored only while it waits, are never listed, and are dropped when the site takes the request. The take command's [receipt](glossary.md#receipt) still keeps the returned request, headers included, for replays with the same [idempotency key](glossary.md#idempotency-key), so pass short-lived site sessions.

`bun test examples/fleet` runs these tests:

- `examples/fleet/test/fleet.test.ts` runs the fleet with one or two plant instances on the real fleet agent. It covers the health screen, a build past its best-before date, removing a site, release channels, a release whose blobs are not exactly its files, a forged audit event that stops collection, the protocol's per-site scope and the relay.
- `examples/fleet/test/ui-bindings.test.ts` checks that every bound capability is on a screen.
- `examples/fleet/e2e/fleet.pw.ts` runs the real host in a browser, from enrollment to release drift on the health screen.

### Site setup

1. Compose `fleetAgentPluginManifest` in the manifest's plugins and `fleetAgentPlugin` in the application's plugins. Place them after the site and network plugins, and after the audit plugin when audit events are forwarded. Startup refuses an application without a provided network port.
2. In the deployment policy, bind `destinations.fleet` to the fleet's https origin and `folders['fleet-releases']` to a writable directory. Without the destination the plugin reaches no fleet, and without the folder it stages no release, but the site runs.
3. Create a `field-sync` enrollment on the fleet's Devices screen. The screen calls this kind a phone, as device link names it.
4. Start the site once with `--fleet-enrollment-code <code>` or `AGENT_NATIVE_FLEET_ENROLLMENT_CODE`. The plugin stores the credential, so later starts need no code.
5. Set `fleet-trust` (`AGENT_NATIVE_FLEET_TRUST`) to the publisher's `key.pub.json` or an array of keys. Without it, no release is staged.
6. Activate a staged release with `site install <releases folder>/<release id> --trust key.pub.json`, by hand or from a timer the site runs.
7. Set `fleet-relay` (`AGENT_NATIVE_FLEET_RELAY`) to `on` only when remote access is wanted. The relay is off by default.

`createFleetAgentPlugin({ intervalMs, relayMs })` changes the cycle and the relay poll.

### Fleet setup

A fleet composes the protocol module and implements its handlers. It composes the device link plugin with the protocol's capabilities as its sync operations. Each handler acts for the calling site and answers only about that site. A fleet stores forwarded audit events as received and accepts each sequence number once, because the site resends after a lost reply.

A fleet attaches a release's files to a resource the site's policy lets it read, so `GET /api/v1/blobs/<digest>` serves them to the site. A build pipeline publishes a release over HTTP with an operator's session:

1. Upload each file under `files/` to `POST /api/v1/blobs` with `Content-Type: application/octet-stream`.
2. Call `release.publish`. Its `release` holds the ID, the version, the parsed `bundle.json` as `manifest` and the parsed `bundle.sig` as `signature`, and `files` holds the returned blob references.
3. Call `channel.assign` to point a channel at the release.

To test a fleet against real sites, compose `fleetNetworkFixture` from `@agent-native/fleet-agent/testing` in place of the network plugin. The test supplies the function that reaches the fleet, as `examples/fleet/test/site.ts` does, and can fail, drop or change answers there.

## References

- [Architecture](architecture.md)
- [Security and compliance](security-and-compliance.md)
- [Mobile](mobile.md)
- [Implementation status](implementation-status.md)
- [Hosted instance](implementation-status.md#hosted-instance)
- [Fleet agent](implementation-status.md#fleet-agent)
- [Architecture](architecture.md#instances-and-hosts)
- [deploy-to-site](../plugins/site/skills/deploy-to-site/SKILL.md)
- [Adapters](adapters.md#storage)
- [`examples/fleet`](../examples/fleet/README.md)
- [connect-a-site-to-a-fleet](../plugins/fleet-agent/skills/connect-a-site-to-a-fleet/SKILL.md)
