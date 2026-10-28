# Connect the lab site to a fleet

The [base lab desk](../base/README.md) runs at a site and reports to the [fleet application](../../examples/fleet/README.md). The site's [fleet agent](../../../docs/primitives.md#fleet-agent) enrolls outbound, reports health, forwards audit events and stages the signed release assigned to its channel. Staging is separate from installing the release.

## Run the site and fleet

Run the pattern against the fleet example on this machine:

1. Start the fleet with `bun run dev:web` in `showcase/examples/fleet`. On the Devices screen, create an enrollment code.
2. Create a release signing key outside the checkout with `bun run bundle keygen --out <dir>/key.json`. It writes `key.pub.json` beside it.
3. Start the site with the code and the public key:

   ```sh
   cd showcase/patterns/site
   AGENT_NATIVE_FLEET_ENROLLMENT_CODE=<code> AGENT_NATIVE_FLEET_TRUST=<dir>/key.pub.json bun run dev:web
   ```

   The fleet's Sites screen lists the lab after the first cycle, and its Audit screen shows the forwarded events.
4. Build and sign a bundle of this pattern, from the repository root:

   ```sh
   AGENT_NATIVE_APPLICATION=@agent-native/pattern-site bun run build:web
   AGENT_NATIVE_APPLICATION=@agent-native/pattern-site bun run bundle create --key <dir>/key.json --out <bundle> --version 1.2.0
   ```

5. Publish it and point a channel at it:

   ```sh
   AGENT_NATIVE_CONNECTION=showcase/examples/fleet/.workspace/.connection.json bun showcase/patterns/site/publish-release.ts <bundle> --channel lab-stable
   ```

6. On the fleet's Sites screen, set the lab's channel to `lab-stable`. Within a minute the release is staged in the `fleet-releases` directory that `dev.ts` printed, and the Health screen shows no drift.
7. Admit the staged release with `bun run bundle admit <releases>/1.2.0 --trust <dir>/key.pub.json`. A first install widens every requirement, so admission is refused. Write the output's `approval` field to `approval.json` to approve it, and run admit again with `--approval approval.json`.
8. Install it under a prefix, without loading anything:

   ```sh
   <bundle>/files/bin/agent-native-desktop-starter install <releases>/1.2.0 \
     --trust <dir>/key.pub.json --site-policy showcase/patterns/site/site-policy.json \
     --approval approval.json --prefix <prefix> --service systemd
   ```

   The prefix then holds the release under `opt/agent-native/test-requests-site`, the systemd unit and `egress.nft`. `app status --prefix <prefix> --trust <dir>/key.pub.json` verifies the current release. `--apply` would load the unit and the rules.
9. Export the firewall rules on their own with `network export --site showcase/patterns/site/site-policy.json --format nftables --resolver <ip> --user agent-native`. `--resolver` admits DNS to the site's resolver, and `--user` matches the account `app install` runs the service as.

The staged binary keeps mode 0644, so step 8 runs the binary from the bundle `bun run bundle create` wrote. `app install` sets mode 0755 on the copy it installs.

## What the site trusts

The site opens no inbound port for the fleet. Every report, audit batch and release download is an outbound request through the network guard, to the destination the policy binds. The site credential from enrollment stays in the workspace.

The fleet stores a release's signature without checking it. The site verifies every file against the signed manifest, and the whole bundle against its own `fleet-trust` keys, before it renames the download into `fleet-releases/<release id>`. A site without `fleet-trust` stages nothing. Staging installs nothing: `app install` admits the bundle again, and a release that widens the requirements needs a site approval.

`publish-release.ts` signs nothing. It uploads a bundle that `bun run bundle create` already signed, with the fleet owner's token from the fleet's connection file.

## Code and checks

[`site-policy.json`](site-policy.json) is the example site-hub policy. [`dev.ts`](dev.ts) supplies loopback bindings for a local run, and [`publish-release.ts`](publish-release.ts) uploads an already signed bundle to the fleet.

```sh
bun test showcase/patterns/site
```

The tests use the real fleet and site applications on loopback, a signed stand-in bundle and rendered firewall rules. They do not load those rules into a firewall or establish a remote site deployment.
