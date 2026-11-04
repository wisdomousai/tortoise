# @tortoise/fleet-agent

The site side of a fleet. Compose `createFleetAgentPlugin` after the site, network and audit plugins. It reports health, forwards the audit log and stages assigned releases, all over outbound calls through the `fleet` destination, and relays remote requests to the site's own API when enabled.

## Trust boundary

- The plugin writes nothing to the workspace. Health reports contain effect counts per target and the build's best-before date, no payloads.
- It forwards audit events unchanged, so the fleet checks the hash chain itself.
- It verifies every release file against the signed manifest before it moves the release into `fleet-releases/<release id>`. Installing stays a manual `app install`.
- The fleet credential lives in the OS secret store or `<workspace>/fleet-agent/credential` (mode 0600) and never rotates.

Primitives:

- [Fleet agent](../../docs/primitives.md#fleet-agent)

## References

- [connect-a-site-to-a-fleet](skills/connect-a-site-to-a-fleet/SKILL.md)
- [Hosting: fleet](../../docs/hosting.md#fleet)
- `bun test plugins/fleet-agent`
