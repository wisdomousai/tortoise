# Connect the lab instance to a fleet

This pattern runs the [base lab desk](../base/README.md) at an instance that reports to the [fleet application](../../examples/fleet/README.md). The fleet agent enrolls by calling the fleet outbound, reports health, forwards audit events and stages the signed release assigned to its channel. The instance opens no inbound port and checks every file against the signed manifest and its own `fleet-trust` keys before staging; `app install` checks the bundle again.

Start the fleet (`bun run dev:web` in `showcase/examples/fleet`), create an enrollment code on **Devices**, create a signing key outside the repository with `bun run bundle keygen --out <dir>/key.json`, and run:

```sh
cd showcase/patterns/fleet-agent
TORTOISE_FLEET_ENROLLMENT_CODE=<code> TORTOISE_FLEET_TRUST=<dir>/key.pub.json bun run dev:web
```

## What to try

- After the first cycle, the fleet's **Instances** screen lists the lab and **Audit** shows the forwarded events.
- Build, sign and publish a release from the repository root with `TORTOISE_APPLICATION=@tortoise/pattern-fleet-agent`: `bun run build:web`, `bun run bundle create --key <dir>/key.json --out <bundle> --version 1.2.0`, then `TORTOISE_CONNECTION=showcase/examples/fleet/.workspace/.connection.json bun showcase/patterns/fleet-agent/publish-release.ts <bundle> --channel lab-stable`. Set the lab's channel to `lab-stable`; within a minute the fleet agent stages the release in the `fleet-releases` directory `dev.ts` printed.
- Admit it with `bun run bundle admit <releases>/1.2.0 --trust <dir>/key.pub.json`. A first install widens every requirement, so admit refuses; write the output's `approval` field to `approval.json` and admit again with `--approval approval.json`.
- Install under a prefix without loading anything: `<bundle>/files/bin/tortoise-starter install <releases>/1.2.0 --trust <dir>/key.pub.json --deployment-policy showcase/patterns/fleet-agent/deployment-policy.json --approval approval.json --prefix <prefix> --service systemd`. `network export --policy showcase/patterns/fleet-agent/deployment-policy.json --format nftables --resolver <ip> --user tortoise` renders the firewall rules on their own.

## References

- [connect-an-instance-to-a-fleet](../../../plugins/fleet-agent/skills/connect-an-instance-to-a-fleet/SKILL.md), [deploy-an-application](../../../plugins/deployment/skills/deploy-an-application/SKILL.md)
- [Fleet agent](../../../plugins/fleet-agent/README.md), [fleet example](../../examples/fleet/README.md)
- `bun test showcase/patterns/fleet-agent` uses loopback hosts, a signed stand-in bundle and rendered rules; it loads nothing into a firewall and deploys to no remote instance
