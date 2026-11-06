---
name: connect-an-instance-to-a-fleet
description: Connect a deployed instance to a fleet service or implement the fleet protocol. Use for enrollment and outbound reports, audit forwarding, signed release staging or the optional remote-access relay.
---

# Connect an instance to a fleet

The fleet agent connects an instance to a fleet and is outbound only. Each cycle it reports outbox counts and the build's best-before date, forwards the audit log events the fleet lacks and stages the assigned release. With the relay on, it also forwards remote-access requests to the instance's own API.

## Before writing

- The instance side needs a provided network port, so startup refuses an application without one.
- The instance acts at the fleet as one device-link principal, never on behalf of a person. Two applications that call each other for people use the peer link instead, as the `connect-two-applications` skill (`plugins/peer-link/skills/connect-two-applications/SKILL.md`) describes.
- The `fleet` destination is declared `authenticated`, so the policy check refuses a plain-text binding off loopback.

## Steps

### Instance side

1. Add `fleetAgentPluginManifest` to the manifest's `plugins`, after the deployment, network and audit plugins.
2. Add `fleetAgentPlugin`, or `createFleetAgentPlugin({ intervalMs })`, to the application's `plugins` in the same order.
3. In the deployment policy, bind `destinations.fleet` to the fleet's https origin. Set its `maxResponseBytes` above the largest release file, because the guard's default cap of 32 MiB is below a compiled binary. The `deploy-an-application` skill (`plugins/deployment/skills/deploy-an-application/SKILL.md`) covers the policy.
4. Bind `folders['fleet-releases']` to a directory the host's OS user can write. Leaving the destination or the folder out disables only that part, and the instance still runs.
5. Create a device-link enrollment on the configured fleet service for the instance protocol.
6. Start the instance once with `--fleet-enrollment-code <code>` or `TORTOISE_FLEET_ENROLLMENT_CODE`. The plugin stores the credential, so later starts need no code.
7. Set `fleet-trust` to the publisher's `key.pub.json` to stage releases. A staged release appears in `fleet-releases/<release id>` only after it verifies.
8. Activate a staged release with `app install <that directory> --trust key.pub.json`, by hand or from a timer the instance runs. A release that widens the requirements also needs `--approval`. The staged files keep mode 0644, so run `app install` from the installed release's binary, or on a first install from a copy of the bundle.
9. Set `fleet-relay` to `on` only when remote access is wanted. A remote caller still needs a session the instance issued. Hosted deployments issue that session through workforce sign-in.

### Fleet side

1. Compose `fleetInstanceModule` from `@tortoise/fleet-agent/contracts` in the fleet application.
2. Implement its handlers. Each handler acts for `ctx.context.principalId`, the calling instance, and returns data only about that instance.
3. Compose the device-link plugin with `syncOperations: fleetInstanceOperationIds`.
4. Attach release files to a resource the fleet's policy lets an instance read, so `GET /api/v1/blobs/<digest>` serves them.
5. Store forwarded audit events as received, and accept each sequence once. The instance reads your cursor before each batch, so a batch is sent again only when its reply was lost.
6. Store the report's `bestBefore` with the instance, and show an instance past it without refusing anything.
7. Revoke a decommissioned instance's device before removing its associated fleet records. An instance that retains valid enrollment can report again.

## Checks

1. Run the tests:

   ```sh
   bun test plugins/fleet-agent
   bun test showcase/patterns/fleet-agent/
   ```

2. Put a new protocol capability in `src/contracts.ts` and in the fixture fleet in `test/fixtures.ts`.
3. Test what the instance does when the fleet refuses the new capability or is unreachable.
4. To test a fleet against real instances, start each instance with `fleetNetworkFixture(reach)` from `@tortoise/fleet-agent/testing` in place of the network plugin. `reach` maps the `fleet` destination onto the fleet's loopback port.
5. Fail, drop or change responses in `reach` to stand in for an unreliable uplink.
6. Record a run against a real fleet across a network as by-hand evidence in [implementation status](../../../../docs/implementation-status.md#fleet-agent).
7. Follow the `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`) for the rest.

## References

- [Deployment and operation](../../../../docs/hosting.md#fleet)
- [`@tortoise/fleet-agent`](../../README.md#trust-boundary)
