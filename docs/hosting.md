# Hosting

The host runs on a server with its workspace in Postgres, and a site connects to a fleet for health reports, audit forwarding and release staging. Application code does not change for either.

## Hosted instance

`serve --hosted-workspace <name>` starts the host with Postgres storage (`packages/host/src/platform/hosted.ts`). It runs on any server with Postgres 15 or newer, targets no managed cloud and has no Cloudflare Workers entry.

### Run one

1. Create a Postgres database the instance can create tables in.
2. Put its URL in `TORTOISE_DATABASE_URL`, from your secret store. The host reads it only from there.
3. Start the instance. Every instance of one workspace uses the same `<name>`:

   ```sh
   bun run cli serve --workspace ./instance --hosted-workspace <name> --port 4317
   ```

   For development, from an app directory: `bun ../../scripts/dev-example.ts --port 4317 --hosted-workspace <name>`.

4. Supervise it. Restart on exit code 1 (lease lost). Exit code 5 means another instance holds the lease ([exit codes](systems-of-record.md#exit-codes)).
5. In the deployment policy, set `ingress.listen` to `tls` with your certificate and key, `identity: external`, the OpenID Connect provider in `workforce`, and bind the `workforce-idp` destination to the provider's origin.
6. Back up the database with its own tools (`pg_dump`, point-in-time recovery).

People sign in through workforce sign-in; nobody gets a local owner session. The instance keeps sessions by token digest in `workforce-sessions.sqlite` in its local directory, so a restart keeps people signed in until their sessions expire. A takeover on another machine without that directory signs everyone out. Reach the instance in attached mode; `backup`, `restore`, `migrate`, `sync`, `drain` and `--embedded` work on local workspaces only.

Check it:

```sh
bun test packages/testing/test/storage.test.ts packages/testing/test/postgres-lease.test.ts packages/host/test/hosted-platform.test.ts
STORAGE_POSTGRES_URL=postgres://user:password@localhost:5432/scratch bun test packages/testing/test/storage.test.ts packages/testing/test/postgres-lease.test.ts
```

The first line runs on PGlite, in process. The second needs a real Postgres.

### Workspace lease and fence

Only one instance commits to a workspace at a time.

- An instance takes the lease when it is free or expired. A second instance gets `CONFLICT` and exits with code 5.
- The lease lasts 30 s; the holder renews it every 10 s, by the database's clock.
- Each new holder gets a fence one higher than the last. Every commit checks the fence inside its transaction, under an advisory lock on the workspace. A paused instance that wakes after a takeover fails its next commit before it reads or writes.
- A renewal that finds the lease gone logs `lease-lost` on stderr and exits with code 1. A clean shutdown releases the lease at once.

Code: `packages/adapters/src/postgres-lease.ts`. Tests: `packages/testing/test/postgres-lease.test.ts`, `packages/host/test/hosted-platform.test.ts`.

### Instance layout

- One instance serves one workspace. For many workspaces, run one instance each behind a router.
- The local `--workspace` directory still holds blobs, agent run history, the audit log and plugin files. Put it on a volume that follows the instance.
- Don't host an app that needs a site: a site-scoped destination, a device, an exchange folder or a station process. Nothing refuses it at startup; check the requirements in the security manifest from `bun run generate`.

## Fleet

### Fleet agent

The fleet agent host plugin (`plugins/fleet-agent`) connects outbound only, through the `fleet` destination. The site needs no inbound rule and keeps working when the fleet is down.

Every minute it:

1. reports health: application, instance, outbox counts per target (no payloads), audit head, staged release, best-before date;
2. forwards the audit events the fleet lacks, 100 at a time, unchanged so the fleet can check the hash chain;
3. downloads the assigned release, checks every file against the signed manifest and the `fleet-trust` keys, and only then moves it into the releases folder.

It never activates a release; you run `app install`. It writes nothing to the workspace. A failed cycle sets `lastError` in `services['fleet-agent']` status and retries next cycle. The plugin stores the credential in the platform secret store, or in `<workspace>/fleet-agent/credential` with mode 0600.

Set up a site:

1. Add `fleetAgentPluginManifest` to the manifest's plugins and `fleetAgentPlugin` to the application's plugins, after the site, network and audit plugins.
2. In the deployment policy, bind `destinations.fleet` to the fleet's https origin and `folders['fleet-releases']` to a writable directory.
3. On the fleet's **Devices** screen, create a `field-sync` enrollment code (the screen calls it a phone).
4. Start the site once with `--fleet-enrollment-code <code>` or `TORTOISE_FLEET_ENROLLMENT_CODE`. Later starts need no code.
5. Set `TORTOISE_FLEET_TRUST` to the publisher's `key.pub.json`. Without it the agent stages nothing.
6. Activate a staged release: `app install <releases folder>/<release id> --trust key.pub.json`.

`createFleetAgentPlugin({ intervalMs, relayMs })` changes the intervals. Test: `bun test plugins/fleet-agent`.

### Relay

Remote access to a site through the fleet. Off by default; set `TORTOISE_FLEET_RELAY=on` to enable it.

- The site polls every 2 s and forwards one request at a time to its own `/api/v1/`, bodies up to 1 MiB, no event streams.
- Cookies never go in, `set-cookie` never comes out, and the site follows no redirects.
- A request reaches a capability only with a session the site issued. The site refuses the fleet credential as a session (403).
- Relaying needs a person at the fleet, so an agent run cannot reach a site.

### Fleet protocol

One module, `fleetSiteModule`. Sites enroll through device link and call as `device:<id>`. Each call returns data about that site only.

| Capability            | Kind    | Use                                         |
| --------------------- | ------- | ------------------------------------------- |
| `fleet.site.report`   | command | Send health.                                |
| `fleet.site.desired`  | query   | Read the release to run.                    |
| `fleet.audit.cursor`  | query   | Where the fleet's copy of the audit log ends. |
| `fleet.audit.ingest`  | command | Send events after that point.               |
| `fleet.relay.claim`   | command | Take the oldest queued relay request.       |
| `fleet.relay.respond` | command | Return the response.                        |

A release is the signed bundle manifest and signature from `packages/bundle`; each file is the blob `sha256:<file sha256>`.

### Fleet application

[`showcase/examples/fleet`](../showcase/examples/fleet/README.md) is a working fleet. It can run as a hosted instance.

- Operators update sites, publish, assign and relay; viewers read.
- The health screen flags: no report for 15 minutes, [held effects](systems-of-record.md#held-effects), a broken audit chain, audit more than 1,000 events behind, release drift, and a build past its best-before date. Thresholds are in `showcase/examples/fleet/handlers/sites.ts`.
- A forged or broken audit event stops collection for that site for good. The fleet keeps the newest 1,000 events per site.
- The fleet checks a release's blobs match its manifest; each site checks the signature. A compromised fleet can withhold releases but not install one.
- `site.remove` deletes a site record. Revoke the device first, or the site re-adds itself on its next report.

Publish a release over HTTP with an operator's session:

1. `POST /api/v1/blobs` each file under `files/` with `Content-Type: application/octet-stream`.
2. Call `release.publish` with `release` (ID, version, parsed `bundle.json` as `manifest`, parsed `bundle.sig` as `signature`) and `files` (the blob references).
3. Call `channel.assign` to point a channel at it.

Test: `bun test showcase/examples/fleet`. To test against real sites, compose `fleetNetworkFixture` from `@tortoise/fleet-agent/testing` in place of the network plugin, as `showcase/examples/fleet/test/site.ts` does.

## See also

- [deploy-to-site](../plugins/site/skills/deploy-to-site/SKILL.md) and [connect-a-site-to-a-fleet](../plugins/fleet-agent/skills/connect-a-site-to-a-fleet/SKILL.md) skills
- [Storage adapters](adapters.md#storage), [instances and hosts](architecture.md#instances-and-hosts), [security and compliance](security-and-compliance.md)
- What has run: [hosted instance](implementation-status.md#hosted-instance), [fleet agent](implementation-status.md#fleet-agent)
