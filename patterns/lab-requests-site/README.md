# @agent-native/pattern-lab-requests-site

`pattern-lab-requests-site` runs the [lab requests pattern](../lab-requests/README.md) unchanged as a site instance that a [fleet](../../docs/glossary.md#fleet) manages. The [fleet agent](../../plugins/fleet-agent/README.md) enrolls the lab with the [fleet example](../../examples/fleet/README.md). It then reports health and backlog, forwards the audit log, and stages the signed releases the lab's channel assigns. A [deployment policy](../../docs/glossary.md#deployment-policy) binds the fleet destination and the releases folder, `bun run bundle` signs a [site bundle](../../docs/glossary.md#site-bundle), and `app install` installs it with a systemd unit and firewall rules.

## Layer

Content (`patterns/*`). It imports the base pattern, the framework and the site, network, audit and fleet agent plugins. The tests also import the fleet example, as the other end of the link.

## Primitives

The pattern is one [application](../../docs/primitives.md#application). It composes:

- [deployment policy](../../docs/primitives.md#deployment-policy): `site-policy.json` for a lab hub in connected mode, and the policy `dev.ts` writes for a launch on this machine;
- [egress guard](../../docs/primitives.md#egress-guard): the network guard, with the fleet binding's `maxResponseBytes` raised for release files, and the nftables and systemd rules `network export` renders;
- [audit log](../../docs/primitives.md#audit-log): the events the fleet agent forwards;
- [fleet agent](../../docs/primitives.md#fleet-agent): enrollment with a one-use code, reports, audit forwarding and release staging, all outbound;
- [site bundle](../../docs/primitives.md#site-bundle): a signed bundle, its verification against `fleet-trust`, admission with a site approval, and `app install`.

Its own files:

| File | Runs in | Holds |
| --- | --- | --- |
| `manifest.ts` | Browser and server | The lab requests module, then the site, network, audit and fleet agent plugin manifests |
| `application.ts` | Server | `createLabRequestsSiteApplication`, with `members` and the fleet cycle interval |
| `screens.tsx` | Browser | The base pattern's screens |
| `dev.ts` | Development launch | A policy binding `fleet` to `http://127.0.0.1:4340` and `fleet-releases` to a new temporary directory |
| `publish-release.ts` | Build machine | `publishRelease`: uploads a bundle's files to the fleet, publishes the release and optionally points a channel at it |
| `site-policy.json` | Site | The lab hub's policy: `site-hub` in connected mode, the fleet at `10.30.0.10`, a fail-closed audit log |

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/pattern-lab-requests-site/manifest` | Browser and server | The lab requests module and the four plugin manifests |
| `@agent-native/pattern-lab-requests-site/application` | Server | `createLabRequestsSiteApplication`; the default export is one with default options |
| `@agent-native/pattern-lab-requests-site/screens` | Browser | The test request screens |
| `@agent-native/pattern-lab-requests-site/publish-release` | Build machine | `publishRelease` |

## Trust boundary

The site opens no inbound port for the fleet. Every report, audit batch and release download is an outbound request through the network guard, to the destination the policy binds. The site credential from enrollment stays in the workspace.

The fleet stores a release's signature without checking it. The site verifies every file against the signed manifest, and the whole bundle against its own `fleet-trust` keys, before it renames the download into `fleet-releases/<release id>`. A site without `fleet-trust` stages nothing. Staging installs nothing: `app install` admits the bundle again, and a release that widens the requirements needs a site approval.

`publish-release.ts` signs nothing. It uploads a bundle that `bun run bundle create` already signed, with the fleet owner's token from the fleet's connection file.

## Dependencies

`@agent-native/pattern-lab-requests`, `@agent-native/site`, `@agent-native/network`, `@agent-native/audit`, `@agent-native/fleet-agent`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/frame`, `@agent-native/client`, `@agent-native/bundle` and `@agent-native/fleet`, whose contracts `publish-release.ts` calls and whose application the tests start.

## Tests

```sh
bun test patterns/lab-requests-site/
```

- `test/site.test.ts`:
  - The real fleet application and the lab site on loopback, linked through the real network guard. The site enrolls with a one-use code and submits a test request. The next cycle reports an empty outbox, the forwarded audit events include the submission, and the fleet reports no health issues.
  - A signed bundle carrying a 40 MiB stand-in binary, published with `publishRelease` to `lab-stable`. It is staged only after the site is on the channel, and the fleet then reports no drift. A site trusting another key stages nothing and records the signature refusal. A site whose binding keeps the guard's 32 MiB cap records `RESPONSE_TOO_LARGE`.
  - The committed policy passes the site check with only `FOLDER_MISSING`, and `network export` renders nftables rules that allow `10.30.0.10` on port 443 and drop the rest.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen in this pattern or the base.

Run the pattern against the fleet example on this machine:

1. Start the fleet with `bun run dev:web` in `examples/fleet`. On the Devices screen, create an enrollment code.
2. Create a release signing key outside the checkout with `bun run bundle keygen --out <dir>/key.json`. It writes `key.pub.json` beside it.
3. Start the site with the code and the public key:

   ```sh
   cd patterns/lab-requests-site
   AGENT_NATIVE_FLEET_ENROLLMENT_CODE=<code> AGENT_NATIVE_FLEET_TRUST=<dir>/key.pub.json bun run dev:web
   ```

   The fleet's Sites screen lists the lab after the first cycle, and its Audit screen shows the forwarded events.
4. Build and sign a bundle of this pattern, from the repository root:

   ```sh
   AGENT_NATIVE_APPLICATION=@agent-native/pattern-lab-requests-site bun run build:web
   AGENT_NATIVE_APPLICATION=@agent-native/pattern-lab-requests-site bun run bundle create --key <dir>/key.json --out <bundle> --version 1.2.0
   ```

5. Publish it and point a channel at it:

   ```sh
   AGENT_NATIVE_CONNECTION=examples/fleet/.workspace/.connection.json bun patterns/lab-requests-site/publish-release.ts <bundle> --channel lab-stable
   ```

6. On the fleet's Sites screen, set the lab's channel to `lab-stable`. Within a minute the release is staged in the `fleet-releases` directory that `dev.ts` printed, and the Health screen shows no drift.
7. Admit the staged release with `bun run bundle admit <releases>/1.2.0 --trust <dir>/key.pub.json`. A first install widens every requirement, so admission is refused. Write the output's `approval` field to `approval.json` to approve it, and run admit again with `--approval approval.json`.
8. Install it under a prefix, without loading anything:

   ```sh
   <bundle>/files/bin/agent-native-desktop-starter install <releases>/1.2.0 \
     --trust <dir>/key.pub.json --site-policy patterns/lab-requests-site/site-policy.json \
     --approval approval.json --prefix <prefix> --service systemd
   ```

   The prefix then holds the release under `opt/agent-native/lab-requests-site`, the systemd unit and `egress.nft`. `app status --prefix <prefix> --trust <dir>/key.pub.json` verifies the current release. `--apply` would load the unit and the rules.
9. Export the firewall rules on their own with `network export --site patterns/lab-requests-site/site-policy.json --format nftables --resolver <ip> --user agent-native`. `--resolver` admits DNS to the site's resolver, and `--user` matches the account `app install` runs the service as.

The staged binary keeps mode 0644, so step 8 runs the binary from the bundle `bun run bundle create` wrote. `app install` sets mode 0755 on the copy it installs.

## Skills

- [connect-a-site-to-a-fleet](../../plugins/fleet-agent/skills/connect-a-site-to-a-fleet/SKILL.md)
- [deploy-to-site](../../plugins/site/skills/deploy-to-site/SKILL.md)

## References

- [Patterns](../../docs/patterns.md)
- [Fleet agent](../../plugins/fleet-agent/README.md)
- [Fleet example](../../examples/fleet/README.md)
- [Site plugin](../../plugins/site/README.md)
- [Network plugin](../../plugins/network/README.md)
- [Security and compliance](../../docs/security-and-compliance.md)
