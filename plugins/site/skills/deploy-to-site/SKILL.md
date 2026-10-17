---
name: deploy-to-site
description: Prepare an agent-native application for a site, plant or customer machine. Use when writing or checking a site policy (profile, destination bindings, exchange folder bindings, TLS or mTLS ingress, identity, workforce sign-in, process bindings with path and hash), building and signing a site bundle, installing, checking or removing a release with site install, exporting firewall or orchestrator rules, or producing compliance evidence. Covers plugins/site, plugins/network, plugins/process, plugins/audit, plugins/compliance and packages/bundle.
---

# Deploy to a site

A site policy is deployment data that binds what the application declares (destinations, processes, ingress, identity, audit) to one site's addresses, executables and certificates. The site plugin resolves it against the composed catalog and refuses a policy below its profile floor; the network, process, audit and compliance plugins enforce it. [Security and compliance](../../../../docs/security-and-compliance.md) is the operator's guide, and the [site plugin README](../../README.md) lists the API and the install order.

## Before writing

- Declarations come first. A destination, exchange folder, device or process the policy binds must be declared by a module or plugin; `bun run generate` writes the security manifest and data flows to `dist/reference/<id>/`, which list what the policy has to bind.
- Pick the profile from where the host runs: `desktop-local`, `site-hub` (paired devices over the site network), `sandbox` or `zero-trust`. The [profiles table](../../../../docs/security-and-compliance.md#profiles) gives each floor.
- The site issues and renews certificates; the host only reads them and warns 30 days before expiry. A secret never goes into the policy or a process environment by hand.

## Steps

1. **Write the policy** starting from `examples/quality-inspection/site-policy.sandbox.json`: `profile`, `mode`, `destinations` with `url` and `addresses` (CIDRs, needed for DNS-rebinding checks and firewall exports), `ca` or `certificatePins` where required, `audit`, `identity` (`grant-file` or `external` with `workforce`), `grants.maxTtlSeconds`, and the listener for TLS or mTLS. In connected mode bind or explicitly disable every required destination.
2. **Bind folders** under `folders`: each declared folder ID to an absolute directory (a POSIX path, a Windows drive path or a UNC share), or `{ "disabled": true, "reason" }`. Two folders may not share a directory; a directory that does not exist yet is a warning, since a share may mount later. A broker or OPC UA server is a `tcp` destination: bind it as `tcp://host:port`, with `tls: true` for a broker on 8883.
3. **Bind processes** under `processes`: each declared process ID to an absolute `executable`, fixed `args`, an absolute `cwd`, `env`, and a `sha256` pin. A driver's ID and contract digest come from `app driver list` (the `write-hardware-driver` skill, `plugins/connector-driver/skills/write-hardware-driver/SKILL.md`).
4. **Check it** offline with `app site check --site <file>`; it exits 2 on any error finding. In a checkout the application CLI is `bun run cli`.
5. **Export rules** for the paths the in-process guard cannot see: `app network export --site <file> --format nftables|windows-firewall|k8s-networkpolicy|k8s-pod|compose|systemd|json`.
6. **Build and sign a bundle** with `bun run bundle keygen --out key.json`, then `bun run bundle create --key key.json --out <dir>`. `create` writes the contract, security manifest and SBOM from the catalog into the bundle. Check it with `bun run bundle verify <dir> --trust key.pub.json` and `bun run bundle admit <dir> --trust key.pub.json --approval <file>`.
7. **Install** with the bundled binary: `site install <bundle> --trust key.pub.json --approval <file>`, staged under `--prefix` first and applied with `--apply`. A refused admission, policy check, render or migration leaves the previous release current. `site status` exits 1 when the active release no longer verifies, and `site uninstall` keeps data unless `--purge` is given.
8. **Evidence:** `app audit verify --log <dir>` and `app compliance report --log <dir> --site <file> --format markdown`. A running host re-checks posture, including certificate validity, on every check.

For the desktop build's shipped policy and packaging, see [desktop](../../../../docs/desktop.md).

## Checks

```sh
bun test plugins/site plugins/network plugins/process
bun test plugins/compliance
bun test apps/desktop/test/site-policy.test.ts
UPDATE_GOLDEN=1 bun test plugins/network   # only after an intended exporter change; review the diff
bun run test:sandbox
```

The exporters are compared with golden files as text; none has been loaded into a firewall or cluster by these tests. Record a by-hand bundle build, install or firewall load in [implementation status](../../../../docs/implementation-status.md#site-install) with its platform.
