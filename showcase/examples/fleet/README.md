# Fleet for site applications

A fleet operator monitors applications running at separate sites. Each site's [fleet agent](../../../docs/primitives.md#fleet-agent) enrolls with a one-use code and makes outbound calls to report health, forward audit events and ask which signed release its channel selects. A site continues its local work if the fleet is unavailable.

## Try the fleet

From the repository root:

```sh
cd showcase/examples/fleet
bun run dev:web
```

The fleet listens on port 4340; `bun run dev` opens a desktop window. On **Devices**, create a `field-sync` enrollment code. The [site pattern](../../patterns/site/README.md) starts a lab site against this fleet and walks through reporting, signing and staging a release on the same machine.

## What a site reports

The fleet agent exchanges the enrollment code for a device credential. Each subsequent report is attributed to that device and includes the application's outbox counts, audit head, staged release and best-before date. The Health screen flags stale reports, held effects, audit problems, release drift and builds past their best-before date. The date is informational: a past-due site continues to run.

Sites forward audit events in sequence. The fleet checks each event's hash and link to the previous event, stores at most the newest 1,000 per site, and stops accepting later batches when a chain break is recorded.

## Publishing and remote access

A build pipeline uploads bundle files as blobs, calls `release.publish` with the signed manifest and signature, and points a channel at the release with `channel.assign`. An operator assigns a site to that channel. The fleet stores the signature; the site verifies the files and signature against its own trusted keys before staging. Staging does not install the release.

For remote access, an operator submits a request for a site's `/api/v1/` path. A site with relay enabled claims the request and forwards it to its own API without adding a credential. The site's own session and authorization checks still apply. A delegated agent cannot create the relay request.

## Trust boundary

- **People.** Only workspace members pass the caller gate. Operators enroll, update sites, publish, assign and relay, and viewers read. `relay.request` needs a person, so an agent run cannot reach a site through the fleet.
- **Sites.** An enrolled site is the device-link principal `device:<id>`, an integration allowlist that calls only the protocol capabilities. Each handler acts for the calling site alone. A site reports about itself, reads its own cursor, and takes and responds to only its own relay requests.
- **Site reads.** Of the fleet's records, a site can read only the release its channel assigns. `GET /api/v1/blobs/<digest>` serves the site that release's files and no other blob.
- **Releases.** The fleet checks that the manifest is a bundle manifest and that the uploaded blobs are exactly its files, by digest and size. It does not judge the signature. Each site checks the signature against its own trusted keys before staging, so a compromised fleet can withhold releases but cannot install one.
- **Audit.** Each forwarded event must have the next sequence number, link to the hash of the event before it, and match its own hash (`hashEvent` from `@agent-native/event-log/chain`). The first event that fails stops collection for that site and records the reason on the site, where the health screen shows it.
- **Audit retention.** The fleet skips events it already holds. A site reads the fleet's cursor before each batch, so a batch is sent again only when its reply was lost.
- **Removal.** `site.remove` needs an operator and a person. It deletes no audit event, so the record of what a removed site did stays in the fleet. It does not revoke the site's device link, which belongs to the device-link plugin, so revoke the device first or the site's next report adds it again.
- **Relay.** A request's headers and body are stored on the request only while it waits. The command receipt keeps the input for as long as receipts are kept. They are never listed and are dropped when the site takes the request. The site adds no credential, so a request reaches a capability only with a session the site issued. The site checks that session as it checks any other caller's.

## Limits

- **Relay receipts.** The receipts of `relay.request` and `fleet.relay.claim` keep the request headers for replays. A site session passed for remote access stays in the fleet's state, so pass short-lived sessions.
- **Broken audit chain.** Collection stops at the first failed event and stays stopped. No capability inspects the break or resumes from the site's current head.
- **Health thresholds.** The stale and audit-behind thresholds are constants in [handlers/sites.ts](handlers/sites.ts). They cannot be set per site or per deployment.
- **Retention.** The fleet keeps the newest 1,000 audit events per site, and the site's own audit log keeps every event. After each response, the fleet removes the oldest responded relay requests beyond 200 in total, and never a queued or claimed one.
- **Missing removals.** No capability deletes a release or channel. `site.remove` leaves the device link, and a removed site's newest 1,000 forwarded audit events stay with no capability to delete them.
- **Release size.** A release has at most 1,000 files of up to 256 MiB each.
- **Relay transport.** The site polls for relay requests every two seconds by default and forwards one at a time. Request bodies reach up to 1,000,000 characters and response bodies up to 1 MiB, with no event streams.
- **Credentials.** A site credential is not rotated, and a lost one needs a new enrollment code.
- **Downloads.** Staging downloads each release file whole without resuming.
- **Devices screen wording.** The Devices screen calls a `field-sync` device a phone, as device-link names it.
- **Evidence.** No site has reported across a real network behind an outbound-only firewall. No staged release has been activated by `app install` on a real machine ([implementation status](../../../docs/implementation-status.md#fleet-agent)).

## Code and checks

[`handlers/sites.ts`](handlers/sites.ts) records reports, [`handlers/releases.ts`](handlers/releases.ts) stores releases, [`handlers/audit.ts`](handlers/audit.ts) checks forwarded chains, and [`handlers/relay.ts`](handlers/relay.ts) queues remote requests.

```sh
bun test showcase/examples/fleet
```

The fleet and site-pattern tests use local hosts and simulated sites. Consult [implementation status](../../../docs/implementation-status.md#fleet-agent) for evidence about actual networked sites and releases.
