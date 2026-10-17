# @agent-native/fleet-agent

The site side of a fleet. A site's authority composes this plugin to report its health to a fleet application, forward its audit log there, stage the releases the fleet assigns, and optionally let the fleet relay remote-access requests to the site's own API. Every connection is outbound, through the network port's `fleet` destination, so the site needs no inbound rule.

Layer: plugins (`plugins/*`). Server only. [Fleet agent](../../docs/primitives.md#fleet-agent) in the primitives index.

## The protocol

`@agent-native/fleet-agent/contracts` holds the operations a fleet application serves to its sites, as `fleetSiteModule`. A fleet composes the module, implements its handlers and enrolls sites with the [device-link plugin](../device-link/README.md) (kind `field-sync`, with `fleetSiteOperationIds` as the sync operations), so each site calls them as its own principal `device:<id>` and the fleet answers only about that site.

| Operation | Kind | What the site does with it |
| --- | --- | --- |
| `fleet.site.report` | command | sends application, instance, outbox counts by target, audit head and staged release |
| `fleet.site.desired` | query | reads the release it should run |
| `fleet.audit.cursor` | query | asks where the fleet's copy of its audit log ends |
| `fleet.audit.ingest` | command | sends the events after that, as the JSON lines of its local log, 100 at a time |
| `fleet.relay.take` | command | takes the oldest remote-access request waiting for it |
| `fleet.relay.answer` | command | returns the site API's response to that request |

A release is the signed bundle manifest and signature (`packages/bundle`); each file is the fleet blob `sha256:<file sha256>`, attached to a resource the site may read.

## Wiring a site

Compose the plugin after the site plugin, the network plugin and (for audit forwarding) the audit plugin. The site policy binds the `fleet` destination to the fleet's https origin and the `fleet-releases` folder to a directory; both are optional, and the site runs without them.

| Setting | Environment | Meaning |
| --- | --- | --- |
| `fleet-enrollment-code` | `AGENT_NATIVE_FLEET_ENROLLMENT_CODE` | one-use code from the fleet, exchanged for the site credential on the first cycle |
| `fleet-trust` | `AGENT_NATIVE_FLEET_TRUST` | release signing keys (`key.pub.json` or an array); absent, releases are not staged |
| `fleet-relay` | `AGENT_NATIVE_FLEET_RELAY` | `on` forwards remote-access requests; default off |

The credential is kept in the platform's secret store when it has one, otherwise in `<workspace>/fleet-agent/credential` with mode 0600. `createFleetAgentPlugin({ intervalMs, relayMs })` sets the cycle (one minute) and the relay poll (two seconds). The service at `services['fleet-agent']` offers `status()`, `sync()` and `relay()`.

## Contents

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/fleet-agent/contracts` | browser-safe | the protocol operations, `fleetSiteModule`, `fleetSiteOperationIds`, the report, release and relay schemas, `fleetLinkComponent` |
| `@agent-native/fleet-agent/plugin-manifest` | browser-safe | `fleetAgentPluginManifest`: the destination, the folder and the settings |
| `@agent-native/fleet-agent/plugin` | server | `createFleetAgentPlugin`, `fleetAgentPlugin`, the service and status types |
| `@agent-native/fleet-agent/testing` | server (tests) | `fleetNetworkFixture`: a network plugin whose `fleet` destination goes through a function the test supplies |

## Trust boundary

- **Nothing waits on the fleet.** The plugin writes nothing to the workspace. A cycle that fails records the reason in `status().lastError` and the next cycle tries again, so the site keeps committing and delivering while the fleet is unreachable. Cycles run one at a time, and only one enrollment runs at once, because the code works once.
- **Reports carry counts, not records.** The outbox is read with the host's trusted identity (`pendingEffects`), and only counts per target leave the site.
- **Audit forwarding keeps no state.** The fleet says where its copy ends, so a lost reply or a restart sends the same events again and the fleet accepts each sequence once. Events go unchanged, so the fleet can check the hash chain.
- **Releases are verified before they appear.** Each file is checked against the signed manifest as it arrives, the whole bundle is verified with `verifyBundle` against `fleet-trust`, and only then is the temporary directory renamed into `fleet-releases/<release id>`. Activation stays with the operator's `site install`; the authority never replaces itself.
- **The relay holds no authority.** It forwards a request to the host's own listener under `/api/v1/` only, passes an allow-list of headers each way (never `cookie` in, never `set-cookie` out), adds no credential and never follows a redirect. A relayed request reaches an operation only with a session the site issued, which the site's identity port and policy check like any other caller's; the site's fleet credential opens nothing on the site. `scripts/boundary-rules.ts` lists `src/relay.ts` as the one fetch outside the egress guard, because its only target is the host itself.
- **The fleet credential goes only to the fleet.** It is sent through the network port's `fleet` client, which resolves every path against the bound origin, with redirects refused.

Limits: the relay polls instead of holding a stream open, and handles one request at a time with bodies up to 1 MiB. A fleet that loses a site's credential re-enrolls it with a new code; there is no rotation yet.

## Tests

```sh
bun test plugins/fleet-agent
```

`test/fleet-agent.test.ts` starts a fixture fleet (device-link plus `fleetSiteModule`) and a site (site, audit and this plugin, with a network fixture that can go offline, drop a reply or corrupt a download) on loopback. It covers enrollment and outbox reports without payloads, a site with no code, audit forwarding with a lost reply, a site that keeps committing while the fleet is unreachable and then reports the backlog, a release changed in transit or at the fleet that never reaches the folder, and a relay that answers 403 without a credential or with the fleet credential and 200 with a session the site issued.

## Skills

- [connect-a-site-to-a-fleet](skills/connect-a-site-to-a-fleet/SKILL.md): composing the plugin, enrolling a site, staging releases and turning on the relay.
