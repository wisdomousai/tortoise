# Connect the lab site to a fleet

This pattern runs the [base lab desk](../base/README.md) at a site that reports to the [fleet application](../../examples/fleet/README.md). The fleet agent enrolls by calling the fleet outbound, reports health, forwards audit events and stages the signed release assigned to its channel. The site opens no inbound port and checks every file against the signed manifest and its own `fleet-trust` keys before staging; `app install` checks the bundle again.

Start the fleet (`bun run dev:web` in `showcase/examples/fleet`), create an enrollment code on **Devices**, create a signing key outside the repository with `bun run bundle keygen --out <dir>/key.json`, and run:

```sh
cd showcase/patterns/site
AGENT_NATIVE_FLEET_ENROLLMENT_CODE=<code> AGENT_NATIVE_FLEET_TRUST=<dir>/key.pub.json bun run dev:web
```

## What to try

- After the first cycle, the fleet's **Sites** screen lists the lab and **Audit** shows the forwarded events.
- Build, sign and publish a release from the repository root with `AGENT_NATIVE_APPLICATION=@agent-native/pattern-site`: `bun run build:web`, `bun run bundle create --key <dir>/key.json --out <bundle> --version 1.2.0`, then `AGENT_NATIVE_CONNECTION=showcase/examples/fleet/.workspace/.connection.json bun showcase/patterns/site/publish-release.ts <bundle> --channel lab-stable`. Set the lab's channel to `lab-stable`; within a minute the fleet agent stages the release in the `fleet-releases` directory `dev.ts` printed.
- Admit it with `bun run bundle admit <releases>/1.2.0 --trust <dir>/key.pub.json`. A first install widens every requirement, so admit refuses; write the output's `approval` field to `approval.json` and admit again with `--approval approval.json`.
- Install under a prefix without loading anything: `<bundle>/files/bin/agent-native-desktop-starter install <releases>/1.2.0 --trust <dir>/key.pub.json --site-policy showcase/patterns/site/site-policy.json --approval approval.json --prefix <prefix> --service systemd`. `network export --site showcase/patterns/site/site-policy.json --format nftables --resolver <ip> --user agent-native` renders the firewall rules on their own.

## References

- [connect-a-site-to-a-fleet](../../../plugins/fleet-agent/skills/connect-a-site-to-a-fleet/SKILL.md), [deploy-to-site](../../../plugins/site/skills/deploy-to-site/SKILL.md)
- [Fleet agent](../../../plugins/fleet-agent/README.md), [fleet example](../../examples/fleet/README.md)
- `bun test showcase/patterns/site` uses loopback hosts, a signed stand-in bundle and rendered rules; it loads nothing into a firewall and deploys to no remote site
