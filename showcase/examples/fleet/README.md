# @agent-native/fleet

`fleet` is the [fleet](../../../docs/glossary.md#fleet) that on-site [instances](../../../docs/glossary.md#instance) report to. Each site runs the [fleet-agent plugin](../../../plugins/fleet-agent/README.md) and connects outbound only. The fleet is an ordinary application with no outbox target and no site-pinned requirement, so it runs on a site host or as a [hosted instance](../../../docs/hosting.md#hosted-instance).

A site uses the fleet to:

- enroll with a one-use code;
- report its outbox backlog by target;
- forward its [audit log](../../../docs/glossary.md#audit-log);
- stage the signed release its channel assigns;
- respond to remote-access requests that operators relay to its own API.

## Layer

Content (`showcase/examples/*`).

## Primitives

The example is one [application](../../../docs/primitives.md#application). It uses:

- [collections](../../../docs/primitives.md#collection) of sites, releases, channels, audit events and relay requests, with generated reads and the default list and record screens, which their [display metadata](../../../docs/primitives.md#display-metadata) labels;
- a [policy](../../../docs/primitives.md#policy) built with `definePolicy`, with enrolled sites as an integration allowlist;
- the [device link](../../../docs/primitives.md#device-link) plugin, to enroll sites as `field-sync` devices;
- the [fleet agent](../../../docs/primitives.md#fleet-agent) protocol, `fleetSiteModule`, as its second module;
- [blob store](../../../docs/primitives.md#blob-store) attachments for release files;
- the hash chain of the [audit log](../../../docs/primitives.md#audit-log), to check forwarded audit events.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/fleet/manifest` | browser and server | Default export: `defineManifest` with ID `fleet`, its module and the fleet protocol. |
| `@agent-native/fleet/application` | server only | Default export: the application. |
| `@agent-native/fleet/screens` | browser | Default export: `defineScreens` with the fleet screens and the device-link enrollment screen. |
| `@agent-native/fleet/*` | see file | Other modules by name: `contracts` (browser-safe), `domain`, `policy`, `server`. |

`createFleetApplication` takes services (`now`, `newId`) and members.

### Capabilities

| Capability | Caller | What it does |
| --- | --- | --- |
| `link.enrollment.create` (device-link) | operator | A one-use code a site starts with, of kind `field-sync`. |
| `site.list`, `site.get`, `site.update` | members; update by operators | Each site's last report. `update` sets a label and the channel. |
| `site.remove` | operators, in person | Deletes a decommissioned site's record and its relay requests. Its forwarded audit events stay. |
| `fleet.health` | members | The sites that need attention, listed below. |
| `release.publish` | operators, from a build pipeline | A signed bundle: `bundle.json`, `bundle.sig` and each file uploaded first as a blob. |
| `release.list`, `release.get`, `channel.list`, `channel.assign` | members; assign by operators | Channels point at one release each. |
| `audit-event.list`, `audit-event.get` | members | Forwarded events, newest first, by site or kind. |
| `relay.request`, `relay.list`, `relay.get` | members; request by an operator in person | A request to a site's `/api/v1/` and the response it returned. |

A site's report holds its application, instance, outbox counts by target, audit position, staged release and the running build's [best-before date](../../../docs/glossary.md#best-before-date). `fleet.health` lists the sites that need attention, by the issue kinds in [Report and release flow](#report-and-release-flow).

The fleet protocol capabilities are for enrolled sites only: `fleet.site.report`, `fleet.site.desired`, `fleet.audit.cursor`, `fleet.audit.ingest`, `fleet.relay.claim` and `fleet.relay.respond`.

### Release publishing

A build pipeline publishes a release over HTTP with an operator's session:

1. Upload each file under `files/` to `POST /api/v1/blobs` with `Content-Type: application/octet-stream`.
2. Call `release.publish` with the parsed `bundle.json` as `release.manifest`, the parsed `bundle.sig` as `release.signature`, and the returned blob references as `files`.
3. Call `channel.assign` to point a channel at the release.

### Running the fleet

```sh
cd showcase/examples/fleet
bun run dev
```

Enroll a site from the Devices screen. Then start the site with `--fleet-enrollment-code <code>` or `AGENT_NATIVE_FLEET_ENROLLMENT_CODE`, and a deployment policy that binds `destinations.fleet` to this host's HTTPS origin.

## Trust boundary

- **People.** Only workspace members pass the caller gate. Operators enroll, update sites, publish, assign and relay, and viewers read. `relay.request` needs a person, so an agent run cannot reach a site through the fleet.
- **Sites.** An enrolled site is the device-link principal `device:<id>`, an integration allowlist that calls only the protocol capabilities. Each handler acts for the calling site alone. A site reports about itself, reads its own cursor, and takes and responds to only its own relay requests.
- **Site reads.** Of the fleet's records, a site can read only the release its channel assigns. `GET /api/v1/blobs/<digest>` serves the site that release's files and no other blob.
- **Releases.** The fleet checks that the manifest is a bundle manifest and that the uploaded blobs are exactly its files, by digest and size. It does not judge the signature. Each site checks the signature against its own trusted keys before staging, so a compromised fleet can withhold releases but cannot install one.
- **Audit.** Each forwarded event must have the next sequence number, link to the hash of the event before it, and match its own hash (`hashEvent` from `@agent-native/event-log/chain`). The first event that fails stops collection for that site and records the reason on the site, where the health screen shows it.
- **Audit retention.** The fleet skips events it already holds. A site reads the fleet's cursor before each batch, so a batch is sent again only when its reply was lost.
- **Removal.** `site.remove` needs an operator and a person. It deletes no audit event, so the record of what a removed site did stays in the fleet. It does not revoke the site's device link, which belongs to the device-link plugin, so revoke the device first or the site's next report adds it again.
- **Relay.** A request's headers and body are stored on the request only while it waits. The command receipt keeps the input for as long as receipts are kept. They are never listed and are dropped when the site takes the request. The site adds no credential, so a request reaches a capability only with a session the site issued. The site checks that session as it checks any other caller's.

## Dependencies

The framework packages and the site, network, audit and device-link plugins, through the root workspace. `@agent-native/fleet-agent` supplies the protocol contracts, and `@agent-native/bundle` the manifest check.

## Tests

```sh
bun test showcase/examples/fleet
```

`test/fleet.test.ts` starts the fleet and one or two plant instances on loopback. Each plant runs the real fleet-agent plugin, and `fleetNetworkFixture` maps its `fleet` destination to the fleet's loopback port. The tests cover:

- reports and the health screen, with stale sites, release drift and a build past its best-before date;
- an operator removing a site, with its audit events kept and a revoked device not reporting it again;
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

## Demonstrated mechanisms

| Mechanism | Code | Proof |
| --- | --- | --- |
| [Application](../../../docs/primitives.md#application) with manifest, application and screens entrypoints | `manifest.ts`, `application.ts` `createFleetApplication`, `screens.tsx` | `e2e/fleet.pw.ts` |
| [Collection](../../../docs/primitives.md#collection) records with generated list and record reads | `contracts/*.ts` `defineCollection`, `collectionList`, `collectionGet`; `collectionListHandler` and `records` in `handlers/*.ts` | `test/fleet.test.ts` |
| A [module](../../../docs/primitives.md#module) shared from a plugin package's contracts entrypoint | `manifest.ts` `modules: [fleetModule, fleetSiteModule]` | `test/fleet.test.ts`, "a site calls only the fleet protocol, about itself" |
| [Device link](../../../docs/primitives.md#device-link) `field-sync` pairing with the protocol capabilities as the device grant | `application.ts` `createDeviceLinkPlugin({ syncOperations: fleetSiteOperationIds })` | `test/fleet.test.ts` `startFleet`; `e2e/fleet.pw.ts` |
| Integration allowlist in a declarative [policy](../../../docs/primitives.md#policy) | `policy.ts` `appPolicy`, its `integrations` entry | `test/fleet.test.ts`, "a site calls only the fleet protocol, about itself" |
| [Membership](../../../docs/primitives.md#membership) caller gate and a person-only rule | `policy.ts` `caller`, `relayRequest` with `person: true` | `packages/runtime/test/policy.test.ts` (framework test only) |
| Audit field allow-list on a capability | `contracts/relay.ts` `relayRequest` `audit.fields`; `contracts/releases.ts` `channelAssign` | `packages/runtime/test/audit.test.ts` (framework test only) |
| [Blob store](../../../docs/primitives.md#blob-store) files attached to a record and readable through it | `handlers/releases.ts` `ctx.attach`; `policy.ts` allowlist `events` | `test/fleet.test.ts`, "a release reaches the sites on its channel, verified, and no other release is readable" |
| Bundle manifest check with the signature stored unchecked | `handlers/releases.ts` `parseBundleManifest` | `test/fleet.test.ts`, "a release whose blobs are not exactly its files is refused"; `e2e/fleet.pw.ts` publishes with a placeholder signature |
| Hash chain check of a forwarded [audit log](../../../docs/primitives.md#audit-log) | `handlers/audit.ts` `breakIn` with `hashEvent` | `test/fleet.test.ts`, "forwarded audit events are verified, and a forged one stops collection visibly" |
| Computed query bound to a [live query](../../../docs/primitives.md#journal-and-live-query) | `handlers/sites.ts` `fleet.health`; its `dependencies` in `contracts/sites.ts`; `ui/health.tsx` `live.liveQueryOptions` | `test/fleet.test.ts` for the issues; `packages/react/src/bindings.test.ts` for the refetch (framework test only) |
| Audit forwarding resumed from the fleet's cursor | `plugins/fleet-agent/src/audit.ts` `forwardAudit` queries `fleet.audit.cursor`; `handlers/audit.ts` skips sequences the fleet holds | `plugins/fleet-agent/test/fleet-agent.test.ts` (fixture fleet only) |
| Stored fields hidden from reads | `handlers/relay.ts` `present` drops `outgoing` | `test/fleet.test.ts`, "through the relay only with a session the site issued" |
| [Capability binding](../../../docs/primitives.md#capability-binding) through registry screens | `ui/*.tsx` `CollectionScreen`, `RecordScreen`, `CapabilityForm` | `test/ui-bindings.test.ts`; `e2e/fleet.pw.ts` |
| Plugin screens merged into the application | `screens.tsx` `plugins: [deviceLinkScreens]` | `e2e/fleet.pw.ts` |
| Injected clock and record keys | `handlers/context.ts` `Services` | `test/fleet.test.ts`, the first test moves `clock.now` past 15 minutes; no test injects record keys |
| Sites running the [fleet agent](../../../docs/primitives.md#fleet-agent) against the fleet on loopback | `test/site.ts` `startPlant` with `fleetNetworkFixture` | `test/fleet.test.ts` |

## Structure

| Path | Holds |
| --- | --- |
| [manifest.ts](manifest.ts) | Browser-safe manifest with the fleet module, the protocol module and the site, network, audit and device-link plugins |
| [application.ts](application.ts) | `createFleetApplication`: state, handlers, policy and plugins |
| [screens.tsx](screens.tsx) | Routes, navigation, capability screens and the device-link screens |
| [contracts.ts](contracts.ts) | `fleetModule` and the capabilities people call |
| [contracts/sites.ts](contracts/sites.ts) | Site collection, `site.update`, `site.remove` and `fleet.health` with its issue kinds |
| [contracts/releases.ts](contracts/releases.ts) | Release and channel collections, `release.publish` and `channel.assign` |
| [contracts/audit.ts](contracts/audit.ts) | Forwarded audit event collection and the per-site limit |
| [contracts/relay.ts](contracts/relay.ts) | Relay request collection and `relay.request` |
| [domain.ts](domain.ts) | `AppState`, roles, `siteIdOf` and `desiredRelease` |
| [policy.ts](policy.ts) | `appPolicy`: the site integration allowlist, the membership gate and per-capability rules |
| [server.ts](server.ts) | `createHandlers`, every handler including the protocol's |
| [handlers/context.ts](handlers/context.ts) | `Services` and the `handler` binder |
| [handlers/sites.ts](handlers/sites.ts) | Site reads, update and removal, health, the report and desired-release handlers |
| [handlers/releases.ts](handlers/releases.ts) | Release and channel reads, publish and channel assignment |
| [handlers/audit.ts](handlers/audit.ts) | Audit event reads, the audit cursor and ingest |
| [handlers/relay.ts](handlers/relay.ts) | Relay reads, the request, take and respond handlers |
| [ui/health.tsx](ui/health.tsx) | Health screen |
| [ui/sites.tsx](ui/sites.tsx) | Site list, and the site screen with the remote-access and removal forms |
| [ui/releases.tsx](ui/releases.tsx) | Release and channel screens |
| [ui/audit.tsx](ui/audit.tsx) | Audit event screens |
| [ui/relay.tsx](ui/relay.tsx) | Relay request screens |
| [test/site.ts](test/site.ts) | A fixture plant application with the real fleet-agent plugin |
| [test/fleet.test.ts](test/fleet.test.ts) | Fleet and plants on loopback |
| [e2e/fleet.pw.ts](e2e/fleet.pw.ts) | Browser spec against the real host |

## Report and release flow

1. An operator creates a `field-sync` enrollment code on the Devices screen, which runs `link.enrollment.create` from the device-link plugin.
2. The site's fleet agent exchanges the code at `/api/v1/link/enroll` for a bearer credential. The device-link plugin resolves it on every request to the principal `device:<id>`, with a grant of the protocol capabilities.
3. Each cycle the site submits `fleet.site.report`. The integration allowlist in [policy.ts](policy.ts) matches `device:` principals and admits only the protocol capabilities.
4. The report handler in [handlers/sites.ts](handlers/sites.ts) takes the site ID from the principal. It inserts the site record on the first report and then overwrites its outbox counts, audit head, staged release and best-before date.
5. A build pipeline with an operator's session uploads each release file as a blob and calls `release.publish`. The handler in [handlers/releases.ts](handlers/releases.ts) parses the bundle manifest and requires exactly one blob per file, matched by digest and size.
6. The handler inserts the release record and attaches each blob to the resource `release:<id>`. It stores the signature without checking it.
7. An operator points a channel at the release with `channel.assign` and assigns the site to it with `site.update`. An unknown channel returns `NOT_FOUND`.
8. When the site has trusted release keys set, it queries `fleet.site.desired`. The handler returns the release the site's channel assigns, through `desiredRelease` in [domain.ts](domain.ts).
9. The site downloads each file from `/api/v1/blobs/sha256:<digest>`. The runtime serves a blob only when the caller may read a resource it is attached to, and the allowlist's `events` rule admits only the release the site's channel assigns.
10. The site verifies every file and the signature against its trusted keys and stages the release ([releases.ts](../../../plugins/fleet-agent/src/releases.ts)). Its next report carries the staged release ID.
11. The `fleet.health` query computes each site's issues on every read, and the Health screen binds it as a live query. The issue kinds are these:
    - **Stale.** No report for 15 minutes.
    - **Held.** Effects held for reconciliation on the site.
    - **Audit broken.** The forwarded audit chain failed a check.
    - **Audit behind.** Forwarding lags the site's head by over 1,000 events.
    - **Release drift.** The staged release differs from the one the site's channel assigns.
    - **Past best-before date.** The site runs a build past the best-before date its last report carried. The site keeps running.
12. An operator removes a decommissioned site with `site.remove` from the site screen, after revoking its device on the Devices screen. The handler in [handlers/sites.ts](handlers/sites.ts) deletes the site record and the site's relay requests.

## Audit forwarding flow

1. The site's fleet agent queries `fleet.audit.cursor`. The handler in [handlers/audit.ts](handlers/audit.ts) returns the last sequence the fleet holds, and `NOT_FOUND` before the first report.
2. The site reads its own audit log after that sequence and sends up to 100 JSON lines per `fleet.audit.ingest` call ([audit.ts](../../../plugins/fleet-agent/src/audit.ts)). The idempotency key names the first and last sequence and the last hash.
3. The ingest handler skips events at or below the fleet's head, so an overlapping batch stores each sequence once. After a lost reply, the next cycle queries the cursor again and sends only the events that follow it.
4. For each following event it checks the sequence number, the link to the previous hash and the event's own hash with `hashEvent` from `@agent-native/event-log/chain`.
5. Each event that passes becomes an audit event record keyed `<site>:<seq>`, and the site's head moves to it.
6. The first event that fails stops the batch and writes the reason to the site's `auditBroken` field. The command still commits, so the break shows on the Health screen.
7. While that field is set, every later ingest call returns the unchanged head.
8. After storing a batch, the handler removes events older than the newest 1,000 for that site.

## Remote access flow

1. An operator submits `relay.request` from the site screen with a method, a path under `/api/v1/`, headers and a body. The policy rule requires the operator role and a person, so a delegated run is refused.
2. The capability's `audit.fields` list puts the site, method and path in the audit log in plain text. For the other input fields the audit log records only their names, along with a digest of the whole input.
3. The handler in [handlers/relay.ts](handlers/relay.ts) checks that the site exists and stores the request as `waiting`. The headers and the base64 body go in a field that reads never return.
4. A site with `fleet-relay` set to `on` polls `fleet.relay.claim`. The handler marks the oldest queued request for the calling site as claimed, drops its stored headers and body, and returns them with the request.
5. The site forwards the request to its own API with an allow-list of headers and no added credential ([relay.ts](../../../plugins/fleet-agent/src/relay.ts)). A request without a session the site issued gets 403.
6. The site submits `fleet.relay.respond`. The handler returns `NOT_FOUND` for an unknown request and `CONFLICT` unless the calling site claimed it. Otherwise it records the status, headers and base64 body.
7. After each response, the handler removes the oldest responded requests beyond 200 in total. It never removes a queued or claimed request.

## Implementation steps

These steps build a new application with `scaffold new` and add the fleet's parts in an order in which the application starts after each step. The kernel refuses a capability without a handler, and device-link refuses a sync operation ID that the catalog lacks. So each capability gets its handler in the same step, before device-link names it.

1. Generate the application from the framework repository's root, as the [create-agent-native-app skill](../../../packages/scaffold/skills/create-agent-native-app/SKILL.md) describes. The target directory must not exist yet. The command writes the application to `showcase/examples/<app-name>` of the new directory, with one collection.

   ```sh
   bun run scaffold new /absolute/path/to/absent-target --name <app-name> --collection <first-record-type>
   ```

   Then install the pinned dependencies from the new checkout's root, where every later command runs. The install also links the skills for coding agents.

   ```sh
   cd /absolute/path/to/absent-target
   bun install --frozen-lockfile
   ```

2. Declare the other records and the capabilities people call, each with its handler. Use `defineCollection`, `collectionList` and `collectionGet` for records, and `defineCapability` for commands. A capability without a screen states a `ui.exception`, as `release.publish` does. The scaffold writes the contract, handler, policy rule and test together at its markers.

   ```sh
   bun run scaffold add collection <next-record-type>
   bun run scaffold add capability <dotted.operation-id> --kind command --description "<what it does, for whom>"
   bun run format
   bun run generate
   ```

3. Reshape what the scaffold generated and the fleet does not have.
   - **Records.** Each collection comes with create and update commands and title and status fields. Replace the fields, and drop the create command where records come from elsewhere, as sites come from reports.
   - **Tests.** The conformance test, each collection's test and the default-screens Playwright spec call those create commands, so rewrite or remove them. Rewrite each generated capability test once its input is widened.
   - **Role.** The generated role is `editor`. Rename it where the domain uses another name, as the fleet uses operator.
   - **Compliance plugin.** The generated entrypoints compose it, and the fleet does not. Keep or remove it in all three entrypoints and in the UI-binding test.
4. Add the protocol and its handlers together, as the fleet side of the [connect-a-site-to-a-fleet skill](../../../plugins/fleet-agent/skills/connect-a-site-to-a-fleet/SKILL.md) describes. Import `fleetSiteModule` and `fleetSiteOperations` from `@agent-native/fleet-agent/contracts`, list the module in the manifest's modules, and write one handler per entry of `fleetSiteOperations`.
   - **Calling site.** Each handler derives the site ID from the calling principal, as `callingSite` does, and reads or writes only that site's records.
   - **First report.** The report handler inserts the site on its first report, with its audit head at `AUDIT_GENESIS` from `@agent-native/contracts`.
5. Write the publish handler. Validate the manifest with `parseBundleManifest` from `@agent-native/bundle/manifest`, match the uploaded blobs to its files, and attach them with `ctx.attach`. Declare `blobs` with the size limit and media type on the capability, so the upload route accepts the files.
6. Write the audit ingest handler. Check each event with `hashEvent` from `@agent-native/event-log/chain` before storing it.
7. Compose device-link in all three entrypoints.
   - **Manifest.** `deviceLinkPluginManifest` from `@agent-native/device-link/plugin-manifest` in `plugins`.
   - **Application.** `createDeviceLinkPlugin({ syncOperations: fleetSiteOperationIds })` from `@agent-native/device-link/plugin` in `plugins`.
   - **Screens.** `deviceLinkScreens` from `@agent-native/device-link/plugin-screens` in the plugins of `defineScreens`.
   - **UI-binding test.** Add the device-link plugin's `ui` directory to the directories the generated test scans. Without it the test fails on the device-link capabilities from this step on.
8. Write the policy with `definePolicy`. Add an integration allowlist whose `is` matches `device:` principals, whose `operations` list is `fleetSiteOperationIds`, and whose `events` rule admits only the release the site may read. Mark each protocol capability `integration`, use `person: true` for remote access, and give the policy an `events` rule for each record type.
9. List in `audit.fields` the input fields that are safe in plain text, and leave out headers, bodies and anything that carries a session.
10. Build the screens with `defineScreens` and the registry items `CollectionScreen`, `RecordScreen` and `CapabilityForm`. Map each operation ID prefix to a screen in `capabilityScreens`.
11. Write the behavior tests, as [test/site.ts](test/site.ts) and [test/fleet.test.ts](test/fleet.test.ts) do.
    - **Fleet.** Start it with `startHost` and a temporary deployment policy.
    - **Enrollment.** Create a `field-sync` enrollment code for each site with `link.enrollment.create`, and pass it as the site's `fleet-enrollment-code` setting.
    - **Sites.** Compose `createFleetAgentPlugin` and `fleetAgentPluginManifest`, with the manifest and plugin of `fleetNetworkFixture` in place of the network plugin. The deployment policy binds the `fleet-releases` folder, and `fleet-trust` is the path to the release signing key's public key file. Set `fleet-relay` to `on` for a relay test.
    - **Cycles.** Drive each site with the agent service's `sync()` and `relay()`.
12. Rewrite the generated Playwright spec under `e2e/` for the fleet's screens.
13. Run these focused checks, then the full check. The [check-a-change skill](../../../packages/testing/skills/check-a-change/SKILL.md) says how to report them.

    ```sh
    bun run format
    bun test showcase/examples/<app-name>
    bun run generate
    bun run test:conformance
    bun run build
    bunx playwright test showcase/examples/<app-name>/e2e
    bun run check
    ```

14. Run the fleet on a site host with the [deploy-to-site skill](../../../plugins/site/skills/deploy-to-site/SKILL.md), or as a hosted instance with the [run-a-hosted-instance skill](../../../packages/host/skills/run-a-hosted-instance/SKILL.md). The fleet declares no outbox target and no site-pinned requirement, so it runs on either.
15. Connect each site with the [connect-a-site-to-a-fleet skill](../../../plugins/fleet-agent/skills/connect-a-site-to-a-fleet/SKILL.md).
    - **Plugins.** The site composes the site, network and audit plugins and `createFleetAgentPlugin`, and its manifest lists `fleetAgentPluginManifest`. Without the audit plugin it forwards no audit events.
    - **Deployment policy.** It binds `destinations.fleet` to the fleet's https origin and the `fleet-releases` folder to a directory.
    - **Settings.** `fleet-trust` is the path to the release signing key's public key file; without it the site stages no release. The site starts once with the enrollment code.

To read a working copy instead, export this example unchanged. It stays under `showcase/examples/fleet`, and the steps above do not start from it.

```sh
bun run scaffold /absolute/path/to/absent-target --name <app-name> --example fleet
```

The example uses no fake system of record. Its tests replace the site's network plugin with `fleetNetworkFixture`, which routes the fleet destination to the fleet's loopback port. A deployed site composes the network plugin instead, which provides the `NetworkPort` from the bound destination in its deployment policy.

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

## Skills

- [connect-a-site-to-a-fleet](../../../plugins/fleet-agent/skills/connect-a-site-to-a-fleet/SKILL.md)
- [run-a-hosted-instance](../../../packages/host/skills/run-a-hosted-instance/SKILL.md)
- [decommission-an-application](../../../plugins/site/skills/decommission-an-application/SKILL.md)

## References

- [Hosting: fleet](../../../docs/hosting.md#fleet)
- [Application lifecycle](../../../docs/application-lifecycle.md)
- [Fleet agent README](../../../plugins/fleet-agent/README.md)
- [Device link README](../../../plugins/device-link/README.md)
- [Architecture](../../../docs/architecture.md)
- [Security and compliance](../../../docs/security-and-compliance.md)
- [connect-a-site-to-a-fleet](../../../plugins/fleet-agent/skills/connect-a-site-to-a-fleet/SKILL.md)
- [run-a-hosted-instance](../../../packages/host/skills/run-a-hosted-instance/SKILL.md)
- [deploy-to-site](../../../plugins/site/skills/deploy-to-site/SKILL.md)
- [Asset survey](../asset-survey/README.md)
- [Asset survey field](../asset-survey-field/README.md)
- [Field service](../field-service/README.md)
- [add-capability](../../../packages/runtime/skills/add-capability/SKILL.md)
- [Setup reference](../../../packages/scaffold/skills/create-agent-native-app/references/new-application.md)
- [extend-mobile-host](../../../packages/mobile/skills/extend-mobile-host/SKILL.md)
- [Authorization](../../../docs/authorization.md)
- [build-screens](../../../packages/frame/skills/build-screens/SKILL.md)
