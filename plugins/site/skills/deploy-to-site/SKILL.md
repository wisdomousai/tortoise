---
name: deploy-to-site
description: Prepare an agent-native application for a site, plant or customer machine. Use when writing or checking a deployment policy (profile, destination bindings, exchange folder bindings, TLS or mTLS ingress, identity, workforce sign-in, process bindings with path and hash), building and signing a site bundle, installing, checking or removing a release with site install, exporting firewall or orchestrator rules, or producing compliance evidence. Covers plugins/site, plugins/network, plugins/process, plugins/audit, plugins/compliance and packages/bundle.
---

# Deploy to a site

A [deployment policy](../../../../docs/glossary.md#deployment-policy) is deployment data. It binds what the application declares to one site's addresses, executables and certificates: destinations, processes, ingress, identity and audit. The site plugin resolves the policy against the composed catalog and refuses a policy below its [hardening profile](../../../../docs/glossary.md#hardening-profile) floor. The network, process, audit and compliance plugins enforce it. [Security and compliance](../../../../docs/security-and-compliance.md) is the site operator's guide, and the [site plugin README](../../README.md) lists the API and the install order.

## Before writing

- Declarations come first. A module or plugin must declare every destination, [exchange folder](../../../../docs/glossary.md#exchange-folder), device or process the policy binds.
- `bun run generate` writes the security manifest and data flows to `dist/reference/<id>/`. They list what the policy has to bind.
- Pick the hardening profile from where the host runs: `desktop-local`, `site-hub` (paired devices over the site network), `sandbox` or `zero-trust`. The [profiles table](../../../../docs/security-and-compliance.md#hardening-profiles) gives each floor.
- The site issues and renews certificates. The host only reads them and warns 30 days before expiry.
- A secret never goes into the policy or a process environment by hand.

## Steps

1. Write the policy, starting from `examples/quality-inspection/site-policy.sandbox.json`. Set:
   - `profile` and `mode`;
   - `destinations` with `url` and `addresses`, the CIDRs needed for DNS-rebinding checks and firewall exports;
   - `ca` or `certificatePins` where required;
   - `audit`;
   - `identity`, either `grant-file` or `external` with `workforce` for [workforce sign-in](../../../../docs/glossary.md#workforce-sign-in);
   - `grants.maxTtlSeconds`;
   - the listener for TLS or mTLS.
2. In connected mode, bind or explicitly disable every required destination.
3. Bind each declared folder ID under `folders` to an absolute directory: a POSIX path, a Windows drive path or a UNC share. Or disable it with `{ "disabled": true, "reason" }`. Two folders may not share a directory. A directory that does not exist yet is a warning, because a share may mount later.
4. Bind a broker or OPC UA server as a `tcp` destination, `tcp://host:port`. Add `tls: true` for a broker on 8883.
5. Bind each declared process ID under `processes` to an absolute `executable`, fixed `args`, an absolute `cwd`, `env`, and a `sha256` pin. A driver's ID and contract digest come from `app driver list`, as the `write-hardware-driver` skill (`plugins/connector-driver/skills/write-hardware-driver/SKILL.md`) describes.
6. Check the policy offline with `app site check --site <file>`. It exits 2 on any error finding. In a checkout, the application CLI is `bun run cli`.
7. Export rules for the paths the in-process egress guard cannot see: `app network export --site <file> --format nftables|windows-firewall|k8s-networkpolicy|k8s-pod|compose|systemd|json`.
8. Create a signing key with `bun run bundle keygen --out key.json`.
9. Build and sign a [site bundle](../../../../docs/glossary.md#site-bundle) with `bun run bundle create --key key.json --out <dir>`. `create` writes the contract, security manifest and SBOM from the catalog into the bundle.
10. Verify the bundle with `bun run bundle verify <dir> --trust key.pub.json`.
11. Admit it with `bun run bundle admit <dir> --trust key.pub.json --approval <file>`.
12. Install with the bundled binary: `site install <bundle> --trust key.pub.json --approval <file>`. Stage it under `--prefix` first, then apply it with `--apply`. A refused admission, policy check, render or migration leaves the previous release current.
13. Use `site status` to check the active release. It exits 1 when that release no longer verifies.
14. Remove a release with `site uninstall`. It keeps data unless `--purge` is given.
15. Produce evidence with `app audit verify --log <dir>` and `app compliance report --log <dir> --site <file> --format markdown`. A running host re-checks posture, including certificate validity, on every check.

[Desktop](../../../../docs/desktop.md) covers the desktop build's shipped policy and packaging.

## Checks

1. Run the tests:

   ```sh
   bun test plugins/site plugins/network plugins/process
   bun test plugins/compliance
   bun test apps/desktop/test/site-policy.test.ts
   bun run test:sandbox
   ```

2. Only after an intended exporter change, update the golden files and review the diff:

   ```sh
   UPDATE_GOLDEN=1 bun test plugins/network
   ```

3. Record a by-hand bundle build, install or firewall load in [implementation status](../../../../docs/implementation-status.md#site-install), with its platform. The tests compare the exporters with golden files as text, and none loads a rule into a firewall or cluster.
