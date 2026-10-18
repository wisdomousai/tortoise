---
name: connect-a-site-to-a-fleet
description: Connect an on-site agent-native authority to a fleet application, or build a fleet that sites report to. Use when composing the fleet-agent plugin, enrolling a site with a code, binding the fleet destination and the fleet-releases folder in a deployment policy, staging signed releases for site install, forwarding the audit log, turning on the remote-access relay, or implementing the fleet side of the protocol (fleetSiteModule with device-link). Covers plugins/fleet-agent.
---

# Connect a site to a fleet

The fleet agent connects a site to a [fleet](../../../../docs/glossary.md#fleet) and is outbound only. Each cycle it reports outbox counts, forwards the [audit log](../../../../docs/glossary.md#audit-log) events the fleet lacks and stages the assigned release. With the relay on, it also forwards remote-access requests to the site's own API. [Hosting](../../../../docs/hosting.md#fleet) explains the protocol, and the [README](../../README.md#trust-boundary) states what each part may and may not do.

## Before writing

- The site side needs a provided network port, so startup refuses an application without one.
- A fleet is an application like any other. `examples/fleet` is a complete fleet: site records, release channels, a health screen, audit events checked against each site's hash chain, and relay requests.

## Steps

### Site side

1. Add `fleetAgentPluginManifest` to the manifest's `plugins`, after the site, network and audit plugins.
2. Add `fleetAgentPlugin`, or `createFleetAgentPlugin({ intervalMs })`, to the application's `plugins` in the same order.
3. In the [deployment policy](../../../../docs/glossary.md#deployment-policy), bind `destinations.fleet` to the fleet's https origin. The `deploy-to-site` skill (`plugins/site/skills/deploy-to-site/SKILL.md`) covers the policy.
4. Bind `folders['fleet-releases']` to a directory the host's OS user can write. Leaving the destination or the folder out disables only that part, and the site still runs.
5. Create a `field-sync` enrollment on the fleet.
6. Start the site once with `--fleet-enrollment-code <code>` or `AGENT_NATIVE_FLEET_ENROLLMENT_CODE`. The plugin stores the credential, so later starts need no code.
7. Set `fleet-trust` to the publisher's `key.pub.json` to stage releases. A staged release appears in `fleet-releases/<release id>` only after it verifies.
8. Activate a staged release with `site install <that directory> --trust key.pub.json`, by hand or from a timer the site runs.
9. Set `fleet-relay` to `on` only when remote access is wanted. A remote caller still needs a session the site issued, for example through the site's [workforce sign-in](../../../../docs/glossary.md#workforce-sign-in).

### Fleet side

1. Compose `fleetSiteModule` from `@agent-native/fleet-agent/contracts` in the fleet application.
2. Implement its handlers. Each handler acts for `ctx.context.principalId`, the calling site, and answers only about that site.
3. Compose the device-link plugin with `syncOperations: fleetSiteOperationIds`.
4. Attach release files to a resource the site's policy lets it read, so `GET /api/v1/blobs/<digest>` serves them.
5. Store forwarded audit events as received, and accept each sequence once. The site reads your cursor before each batch, so a batch arrives again only when its reply was lost.

## Checks

1. Run the tests:

   ```sh
   bun test plugins/fleet-agent
   ```

2. Put a new protocol capability in `src/contracts.ts` and in the fixture fleet in `test/fixtures.ts`.
3. Test what the site does when the fleet refuses the new capability or is unreachable.
4. To test a fleet against real sites, start each site with `fleetNetworkFixture(reach)` from `@agent-native/fleet-agent/testing` in place of the network plugin. `reach` maps the `fleet` destination onto the fleet's loopback port, as `examples/fleet/test/site.ts` does.
5. Fail, drop or change answers in `reach` to stand in for an unreliable uplink.
6. Record a run against a real fleet across a network as by-hand evidence in [implementation status](../../../../docs/implementation-status.md#fleet-agent).
7. Follow the `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`) for the rest.
