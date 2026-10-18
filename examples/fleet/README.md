# @agent-native/fleet

The fleet that on-site authorities report to. Each site runs the [fleet-agent plugin](../../plugins/fleet-agent/README.md) and connects outbound only. It enrolls here with a one-use code, reports its outbox backlog by target, forwards its audit log, stages the signed release its channel assigns, and answers remote-access requests that operators relay to its own API. The fleet is an ordinary application: it has no outbox target and no site-pinned requirement, so it runs on a site host or as a [hosted authority](../../packages/host/skills/run-a-hosted-authority/SKILL.md).

Technical documentation: [`DOCUMENTATION.md`](DOCUMENTATION.md).

Layer: content (`examples/*`). It has 1,236 lines of application source outside its tests.

## Primitives

This is one [Application](../../docs/primitives.md#application). It uses:

- [Collections](../../docs/primitives.md#collection) of sites, releases, channels, audit events and relay requests, with generated reads and the default list and record screens;
- a [Policy](../../docs/primitives.md#policy) built with `definePolicy`, with enrolled sites as an integration lane;
- the [Device link](../../docs/primitives.md#device-link) plugin to enroll sites as `field-sync` devices;
- the [Fleet agent](../../docs/primitives.md#fleet-agent) protocol, `fleetSiteModule`, as its second module;
- [Blob store](../../docs/primitives.md#blob-store) attachments for release files;
- the hash chain of the [Event log](../../docs/primitives.md#event-log) to check forwarded audit events.

The `site`, `network`, `audit` and `device-link` [host plugins](../../docs/primitives.md#host-plugin) are listed in each entrypoint.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/fleet/manifest` | browser and server | Default export: `defineManifest` with id `fleet`, its module and the fleet protocol. |
| `@agent-native/fleet/application` | server only | Default export: the application. `createFleetApplication` takes services (`now`, `newId`) and members. |
| `@agent-native/fleet/screens` | browser | Default export: `defineScreens` with health, sites, releases, channels, audit events, remote access and the device-link enrollment screen. |
| `@agent-native/fleet/*` | see file | Other modules by name: `contracts` (browser-safe), `domain`, `policy`, `server`. |

## Operations

| Operation | Who | What it does |
| --- | --- | --- |
| `link.enrollment.create` (device-link) | operator | A one-use code a site starts with; kind `field-sync` |
| `site.list`, `site.get`, `site.update` | members; update by operators | Each site's last report: application, instance, outbox counts by target, audit position, staged release. `update` sets a label and the channel |
| `fleet.health` | members | Sites not reporting for 15 minutes, with held effects, a broken audit chain, audit forwarding over 1,000 events behind, or a staged release other than their channel's |
| `release.publish` | operators, from a build pipeline | A signed bundle: `bundle.json`, `bundle.sig`, and each file uploaded first as a blob (`POST /api/v1/blobs`) |
| `release.list`, `release.get`, `channel.list`, `channel.assign` | members; assign by operators | Channels point at one release each |
| `audit-event.list`, `audit-event.get` | members | Forwarded events, newest first, by site or kind |
| `relay.request`, `relay.list`, `relay.get` | members; request by an operator in person | A request to a site's `/api/v1/` and the response it returned |

The fleet protocol operations (`fleet.site.report`, `fleet.site.desired`, `fleet.audit.cursor`, `fleet.audit.ingest`, `fleet.relay.take`, `fleet.relay.answer`) are for enrolled sites only.

A build pipeline publishes a release over HTTP with an operator's session: upload each file under `files/` with `Content-Type: application/octet-stream`, then call `release.publish` with the parsed `bundle.json` as `release.manifest`, the parsed `bundle.sig` as `release.signature`, and the returned blob references as `files`. Then `channel.assign` points a channel at it.

## Trust boundary

- **People.** Only workspace members pass the caller gate. Operators enroll, update sites, publish, assign and relay; viewers read. `relay.request` needs a person, so an agent run cannot reach a site through the fleet.
- **Sites.** An enrolled site is the device-link principal `device:<id>`, an integration lane that calls only the protocol operations. Each handler acts for the calling site alone: a site reports about itself, reads its own cursor, takes and answers only its own relay requests. Of the fleet's records, a site can read only the release its channel assigns, so `GET /api/v1/blobs/<digest>` serves it that release's files and no other blob.
- **Releases.** The fleet checks that the manifest is a bundle manifest and that the uploaded blobs are exactly its files, by digest and size. It does not judge the signature. Each site checks it against its own trusted keys before staging, so a fleet that is compromised can withhold releases but cannot install one.
- **Audit.** Each forwarded event must have the next sequence number, link to the hash of the event before it, and match its own hash (`hashEvent` from `@agent-native/event-log/chain`). The first event that fails stops collection for that site and records why on the site, where the health view shows it. Events the fleet already holds are skipped, so a batch repeated after a lost reply is harmless; the site reads the fleet's cursor before each batch. The fleet keeps the newest 1,000 events per site; the site's own log keeps them all.
- **Relay.** A request's headers and body are stored on the request only while it waits, are never listed, and are dropped when the site takes it; the command receipt keeps the input for as long as receipts are kept. The site adds no credential, so a request reaches an operation only with a session the site issued, and the site checks that session as it checks any other caller's.

Limits: the command receipt of `fleet.relay.take` keeps the request it returned, headers included, for replays with the same idempotency key, so pass short-lived site sessions. A broken audit chain stays broken: there is no operation yet to inspect the break and resume collection from the site's current head. Health thresholds are constants in `handlers/sites.ts`.

## Dependencies

Framework packages, the site, network, audit and device-link plugins, `@agent-native/fleet-agent` for the protocol contracts and `@agent-native/bundle` for the manifest check, through the root workspace.

## Running it

```sh
cd examples/fleet && bun run dev
```

Enroll a site from the Devices screen, then start the site with `--fleet-enrollment-code <code>` (or `AGENT_NATIVE_FLEET_ENROLLMENT_CODE`) and a site policy binding `destinations.fleet` to this host's https origin. The [connect-a-site-to-a-fleet skill](../../plugins/fleet-agent/skills/connect-a-site-to-a-fleet/SKILL.md) has the steps.

## Tests

```sh
bun test examples/fleet
```

`test/fleet.test.ts` starts the fleet and one or two plant authorities on loopback. Each plant runs the real fleet-agent plugin, whose `fleet` destination is mapped to the fleet's loopback port by `fleetNetworkFixture`. The tests cover reports and the health view (stale sites and release drift), a release reaching only the sites on its channel and no other release being readable, a release whose blobs are not exactly its files, audit events verified against the hash chain and a forged event stopping collection, a site calling only the protocol and only about itself, and an operator reaching a plant's API through the relay only with a session the plant issued. `test/ui-bindings.test.ts` checks that every bound operation is on a screen. `e2e/fleet.pw.ts` runs the real service in a browser: an operator creates an enrollment code on the Devices screen, the spec redeems it and reports as the site, publishes a release over HTTP, and the operator creates a channel, assigns the site to it and sees the drift on the Health screen.
