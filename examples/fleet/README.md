# @agent-native/fleet

`fleet` is the [fleet](../../docs/glossary.md#fleet) that on-site [authorities](../../docs/glossary.md#authority) report to. Each site runs the [fleet-agent plugin](../../plugins/fleet-agent/README.md) and connects outbound only. The fleet is an ordinary application with no outbox target and no site-pinned requirement, so it runs on a site host or as a [hosted authority](../../docs/hosting.md#hosted-authority).

A site uses the fleet to:

- enroll with a one-use code;
- report its outbox backlog by target;
- forward its [audit log](../../docs/glossary.md#audit-log);
- stage the signed release its channel assigns;
- answer remote-access requests that operators relay to its own API.

The example demonstrates the fleet described in [hosting](../../docs/hosting.md#fleet).

## Layer

Content (`examples/*`). It has 1,236 lines of application source outside its tests.

## Primitives

The example is one [application](../../docs/primitives.md#application). It uses:

- [collections](../../docs/primitives.md#collection) of sites, releases, channels, audit events and relay requests, with generated reads and the default list and record screens;
- a [policy](../../docs/primitives.md#policy) built with `definePolicy`, with enrolled sites as an integration lane;
- the [device link](../../docs/primitives.md#device-link) plugin, to enroll sites as `field-sync` devices;
- the [fleet agent](../../docs/primitives.md#fleet-agent) protocol, `fleetSiteModule`, as its second module;
- [blob store](../../docs/primitives.md#blob-store) attachments for release files;
- the hash chain of the [audit log](../../docs/primitives.md#audit-log), to check forwarded audit events.

The manifest and the application list the `site`, `network`, `audit` and `device-link` [host plugins](../../docs/primitives.md#host-plugin). The screens compose the device-link enrollment screen.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/fleet/manifest` | browser and server | Default export: `defineManifest` with ID `fleet`, its module and the fleet protocol. |
| `@agent-native/fleet/application` | server only | Default export: the application. |
| `@agent-native/fleet/screens` | browser | Default export: `defineScreens` with the fleet screens and the device-link enrollment screen. |
| `@agent-native/fleet/*` | see file | Other modules by name: `contracts` (browser-safe), `domain`, `policy`, `server`. |

`createFleetApplication` takes services (`now`, `newId`) and members. The fleet screens are health, sites, releases, channels, audit events and remote access.

### Capabilities

| Capability | Caller | What it does |
| --- | --- | --- |
| `link.enrollment.create` (device-link) | operator | A one-use code a site starts with, of kind `field-sync`. |
| `site.list`, `site.get`, `site.update` | members; update by operators | Each site's last report. `update` sets a label and the channel. |
| `fleet.health` | members | The sites that need attention, listed below. |
| `release.publish` | operators, from a build pipeline | A signed bundle: `bundle.json`, `bundle.sig` and each file uploaded first as a blob. |
| `release.list`, `release.get`, `channel.list`, `channel.assign` | members; assign by operators | Channels point at one release each. |
| `audit-event.list`, `audit-event.get` | members | Forwarded events, newest first, by site or kind. |
| `relay.request`, `relay.list`, `relay.get` | members; request by an operator in person | A request to a site's `/api/v1/` and the response it returned. |

A site's report holds its application, instance, outbox counts by target, audit position and staged release. `fleet.health` lists the sites that match any of these:

- not reporting for 15 minutes;
- with held effects;
- with a broken audit chain;
- with audit forwarding over 1,000 events behind;
- with a staged release other than their channel's.

The fleet protocol capabilities are for enrolled sites only: `fleet.site.report`, `fleet.site.desired`, `fleet.audit.cursor`, `fleet.audit.ingest`, `fleet.relay.take` and `fleet.relay.answer`.

### Release publishing

A build pipeline publishes a release over HTTP with an operator's session:

1. Upload each file under `files/` to `POST /api/v1/blobs` with `Content-Type: application/octet-stream`.
2. Call `release.publish` with the parsed `bundle.json` as `release.manifest`, the parsed `bundle.sig` as `release.signature`, and the returned blob references as `files`.
3. Call `channel.assign` to point a channel at the release.

### Running the fleet

```sh
cd examples/fleet
bun run dev
```

Enroll a site from the Devices screen. Then start the site with `--fleet-enrollment-code <code>` or `AGENT_NATIVE_FLEET_ENROLLMENT_CODE`, and a site policy that binds `destinations.fleet` to this host's HTTPS origin. The [connect-a-site-to-a-fleet](../../plugins/fleet-agent/skills/connect-a-site-to-a-fleet/SKILL.md) skill has the steps.

## Trust boundary

- **People.** Only workspace members pass the caller gate. Operators enroll, update sites, publish, assign and relay, and viewers read. `relay.request` needs a person, so an agent run cannot reach a site through the fleet.
- **Sites.** An enrolled site is the device-link principal `device:<id>`, an integration lane that calls only the protocol capabilities. Each handler acts for the calling site alone. A site reports about itself, reads its own cursor, and takes and answers only its own relay requests.
- **Site reads.** Of the fleet's records, a site can read only the release its channel assigns. `GET /api/v1/blobs/<digest>` serves the site that release's files and no other blob.
- **Releases.** The fleet checks that the manifest is a bundle manifest and that the uploaded blobs are exactly its files, by digest and size. It does not judge the signature. Each site checks the signature against its own trusted keys before staging, so a compromised fleet can withhold releases but cannot install one.
- **Audit.** Each forwarded event must have the next sequence number, link to the hash of the event before it, and match its own hash (`hashEvent` from `@agent-native/event-log/chain`). The first event that fails stops collection for that site and records the reason on the site, where the health screen shows it.
- **Audit retention.** The fleet skips events it already holds, because a site resends after a lost reply. It keeps the newest 1,000 events per site, and the site's own log keeps them all.
- **Relay.** A request's headers and body are stored only while it waits. They are never listed and are dropped when the site takes the request. The site adds no credential, so a request reaches a capability only with a session the site issued. The site checks that session as it checks any other caller's.

The fleet has these limits:

- The command receipt of `fleet.relay.take` keeps the request it returned, headers included, for replays with the same idempotency key. Pass short-lived site sessions.
- A broken audit chain stays broken. No capability exists yet to inspect the break and resume collection from the site's current head.
- Health thresholds are constants in `handlers/sites.ts`.

## Dependencies

The framework packages and the site, network, audit and device-link plugins, through the root workspace. `@agent-native/fleet-agent` supplies the protocol contracts, and `@agent-native/bundle` the manifest check.

## Tests

```sh
bun test examples/fleet
```

`test/fleet.test.ts` starts the fleet and one or two plant authorities on loopback. Each plant runs the real fleet-agent plugin, and `fleetNetworkFixture` maps its `fleet` destination to the fleet's loopback port. The tests cover:

- reports and the health screen, with stale sites and release drift;
- a release reaching only the sites on its channel, with no other release readable;
- a release whose blobs are not exactly its files;
- audit events verified against the hash chain, and a forged event stopping collection;
- a site calling only the protocol, and only about itself;
- an operator reaching a plant's API through the relay only with a session the plant issued.

`test/ui-bindings.test.ts` checks that every bound capability is on a screen.

`e2e/fleet.pw.ts` runs the real host in a browser:

1. An operator creates an enrollment code on the Devices screen.
2. The spec redeems it, reports as the site and publishes a release over HTTP.
3. The operator creates a channel, assigns the site to it and sees the drift on the Health screen.

## Skills

- [connect-a-site-to-a-fleet](../../plugins/fleet-agent/skills/connect-a-site-to-a-fleet/SKILL.md) covers enrollment, reports, audit forwarding, release staging and the relay.
- [run-a-hosted-authority](../../packages/host/skills/run-a-hosted-authority/SKILL.md) covers running the fleet as a hosted authority.
