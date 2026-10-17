---
name: connect-a-site-to-a-fleet
description: Connect an on-site agent-native authority to a fleet application, or build a fleet that sites report to. Use when composing the fleet-agent plugin, enrolling a site with a code, binding the fleet destination and the fleet-releases folder in a site policy, staging signed releases for site install, forwarding the audit log, turning on the remote-access relay, or implementing the fleet side of the protocol (fleetSiteModule with device-link). Covers plugins/fleet-agent.
---

# Connect a site to a fleet

The fleet agent is outbound only: each cycle it reports outbox counts, forwards the audit events the fleet lacks and stages the assigned release, and with the relay on it forwards remote-access requests to the site's own API. The [README](../../README.md#trust-boundary) states what each part may and may not do.

## Site side

1. **Compose** `fleetAgentPluginManifest` in the manifest's `plugins` and `fleetAgentPlugin` (or `createFleetAgentPlugin({ intervalMs })`) in the application's `plugins`, after the site, network and audit plugins. The plugin needs a provided network port, so startup refuses an application without one.
2. **Bind** in the site policy (the `deploy-to-site` skill, `plugins/site/skills/deploy-to-site/SKILL.md`): `destinations.fleet` to the fleet's https origin, and `folders['fleet-releases']` to a directory the service account can write. Leaving either out disables that part, not the site.
3. **Enroll**: create a `field-sync` enrollment on the fleet, then start the site once with `--fleet-enrollment-code <code>` or `AGENT_NATIVE_FLEET_ENROLLMENT_CODE`. The credential is stored; later starts need no code.
4. **Stage releases** by setting `fleet-trust` to the publisher's `key.pub.json`. A staged release appears in `fleet-releases/<release id>` only after it verifies. Activate it with `site install <that directory> --trust key.pub.json`, by hand or from a timer the site runs.
5. **Relay** only when remote access is wanted: `fleet-relay on`. A remote caller still needs a session the site issued, for example through the site's workforce sign-in.

## Fleet side

A fleet is an application like any other. Compose `fleetSiteModule` from `@agent-native/fleet-agent/contracts`, implement its handlers, and compose the device-link plugin with `syncOperations: fleetSiteOperationIds`. Each handler acts for `ctx.context.principalId`, the calling site, and must answer only about that site. Attach release files to a resource the site's policy lets it read, so `GET /api/v1/blobs/<digest>` serves them. Store forwarded audit events as received and accept each sequence once: the site resends after a lost reply.

`examples/fleet` is a complete fleet built this way: site records, release channels, a health view, audit events checked against each site's hash chain, and relay requests.

To test a fleet against real sites, start each site with `fleetNetworkFixture(reach)` from `@agent-native/fleet-agent/testing` in place of the network plugin, with `reach` mapping the `fleet` destination onto the fleet's loopback port, as `examples/fleet/test/site.ts` does. Fail, drop or change answers in `reach` to stand in for an unreliable uplink.

## Checks

```sh
bun test plugins/fleet-agent
```

A new protocol operation goes in `src/contracts.ts`, in the fixture fleet in `test/fixtures.ts`, and in a test of what the site does when the fleet refuses or is unreachable. A run against a real fleet across a network is by-hand evidence for `docs/implementation-status.md`. The `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`) covers the rest.
