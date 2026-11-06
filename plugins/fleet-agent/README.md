# @tortoise/fleet-agent

`@tortoise/fleet-agent` connects an instance to its configured fleet service using outbound requests through the `fleet` destination. `createFleetAgentPlugin` is composed after its required host plugins. It reports instance health and forwards the audit events the fleet has not received.

An assigned release is downloaded and checked against the signed manifest before staging. Installation requires the separate deployment command. Optional relay polling forwards a request to the instance's API, where the supplied instance session still determines access.

## Trust boundary

The plugin writes nothing to the workspace. Health reports contain effect counts per target and the build's best-before date, no payloads.

It forwards audit events unchanged, so the fleet checks the hash chain itself.

It verifies every release file against the signed manifest before it moves the release into `fleet-releases/<release id>`. Installing stays a manual `app install`.

The fleet credential lives in the OS secret store or `<workspace>/fleet-agent/credential` (mode 0600) and never rotates.

## References

[connect-an-instance-to-a-fleet](skills/connect-an-instance-to-a-fleet/SKILL.md)

[Hosting: fleet](../../docs/hosting.md#fleet)

`bun test plugins/fleet-agent`
