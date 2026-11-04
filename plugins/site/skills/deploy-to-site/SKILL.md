---
name: deploy-to-site
description: Prepare an agent-native application for a site, plant or customer machine. Use when writing or checking a deployment policy (profile, destination bindings, exchange folder bindings, TLS or mTLS ingress, peer destinations, identity, workforce sign-in, process bindings with path and hash), building and signing a site bundle, installing, checking or removing a release with app install, app status and app uninstall, exporting firewall or orchestrator rules, or producing compliance evidence. Covers plugins/site, plugins/network, plugins/process, plugins/audit, plugins/compliance and packages/bundle.
---

# Deploy to a site

A deployment policy binds what the application declares to one site's addresses, executables and certificates: destinations, processes, ingress, identity and audit. The site plugin resolves the policy against the composed catalog and refuses a policy below its hardening profile floor. The network, process, audit and compliance plugins enforce it.

## Before writing

- A module or plugin must declare every destination, exchange folder, device or process the policy binds.
- `bun run generate` writes the security manifest and data flows to `dist/reference/<id>/`. They list what the policy has to bind.
- Pick the hardening profile from where the host runs: `desktop-local`, `site-hub` (paired devices over the site network), `sandbox` or `zero-trust`.
- The site issues and renews certificates. The host only reads them and warns 30 days before expiry.
- A secret never goes into the policy or a process environment by hand.
- `showcase/patterns/site` includes a connected `site-hub` policy, and its README runs steps 9 to 14 on a release a fleet staged.

## Steps

1. Write the policy, starting from `showcase/examples/quality-inspection/site-policy.sandbox.json`, or from `apps/desktop/site-policy.json` in an exported application. Set:
   - `profile` and `mode`;
   - `destinations` with `url` and `addresses`, the CIDRs needed for DNS-rebinding checks and firewall exports;
   - `timeoutMs` on a destination that responds slowly, and `maxResponseBytes` on one that serves files over 32 MiB, such as a fleet's releases;
   - `ca` or `certificatePins` where required;
   - `audit`;
   - `identity`, either `grant-file` or `external` with `workforce` for workforce sign-in;
     Bind `workforce-idp` to the provider's `https` origin. Before a real provider is configured, `startIdentityProvider` from `@tortoise/site/testing` stands in for it with a certificate the binding's `ca` trusts;
   - `grants.maxTtlSeconds`;
   - the listener for TLS or mTLS.
2. In connected mode, bind or explicitly disable every required destination.
3. Bind each declared folder ID under `folders` to an absolute directory: a POSIX path, a Windows drive path or a UNC share. Or disable it with `{ "disabled": true, "reason" }`. Two folders may not share a directory. A directory that does not exist yet is a warning, because a share may mount later.
4. Bind a broker or OPC UA server as a `tcp` destination, `tcp://host:port`. Add `tls: true` for a broker on 8883.
5. Bind a peer application's destination, which `definePeerTarget` declares `authenticated`, to the peer's `https` origin, with `ca` when its certificate chains to the site CA. The check refuses plain text off loopback. An `mtls` listener on the called application refuses the peer, because the peer link presents no client certificate.
6. Bind each declared process ID under `processes` to an absolute `executable`, fixed `args`, an absolute `cwd`, `env`, and a `sha256` pin. A driver's ID and contract digest come from `app driver list`, as the `write-hardware-driver` skill (`plugins/connector-driver/skills/write-hardware-driver/SKILL.md`) describes.
7. Check the policy offline with `app site check --site <file>`. It exits 2 on any error finding. In a checkout, the application CLI is `bun run cli`.
8. Export rules for the paths the in-process egress guard cannot see: `app network export --site <file> --format nftables|windows-firewall|k8s-networkpolicy|k8s-pod|compose|systemd|json`.
9. Create a signing key with `bun run bundle keygen --out <dir>/key.json`, in a directory outside the repository, so the private key is never committed.
10. Run `bun run build:web`, then build and sign a site bundle with `bun run bundle create --key key.json --out <dir>`. `create` compiles the application CLI into `<dir>/files/bin/<app>` and writes the contract, security manifest and SBOM from the catalog into the bundle.
11. Verify the bundle with `bun run bundle verify <dir> --trust key.pub.json`.
12. Admit it with `bun run bundle admit <dir> --trust key.pub.json --approval <file>`. Without `--approval`, a bundle whose requirements widen is refused and the output prints the `approval` object; the site saves that object as the approval file.
13. Install with the bundled binary, `<bundle>/files/bin/<app> install <bundle> --trust key.pub.json --site-policy <file> --approval <file> --service systemd|windows|none`. `--prefix` defaults to `/`, so stage under a temporary `--prefix` first to read what install writes. Then install without `--prefix`, with `--apply` to run the service and firewall commands. A staged tree is for reading and is not promoted. On macOS the service is `none` and nothing is applied. A refused admission, policy check, render or migration leaves the previous release current.
14. Use `app status` to check the active release and its best-before date. It exits 1 when that release no longer verifies.
15. Remove a release with `app uninstall`, which keeps the data. To delete the data too, follow the `decommission-an-application` skill (`plugins/site/skills/decommission-an-application/SKILL.md`).
16. Produce evidence with `app audit verify --log <dir>` and `app compliance report --log <dir> --site <file> --format markdown`. A running host re-checks posture, including certificate validity, on every check.

## Checks

1. Run the tests:

   ```sh
   bun test plugins/site plugins/network plugins/process
   bun test plugins/compliance
   bun test apps/desktop/test/site-policy.test.ts
   bun test showcase/patterns/site/
   ```

   Also run `bun run test:sandbox` when the project has that script; a source export can omit it.

2. Only after an intended exporter change, update the golden files and review the diff:

   ```sh
   UPDATE_GOLDEN=1 bun test plugins/network
   ```

3. Record a by-hand bundle build, install or firewall load in [implementation status](../../../../docs/implementation-status.md#install), with its platform. The tests compare the exporters with golden files as text, and none loads a rule into a firewall or cluster.

## References

- [Security and compliance](../../../../docs/security-and-compliance.md)
- [`@tortoise/site`](../../README.md)
- [Profiles table](../../../../docs/security-and-compliance.md#hardening-profiles)
- [Desktop](../../../../docs/desktop.md)
- [Site pattern](../../../../showcase/patterns/site/README.md)
