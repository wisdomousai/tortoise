---
name: decommission-an-application
description: Prepare an installation for removal and verify its retained data and unresolved deliveries. Use for uninstall and purge operations, shelf-life metadata, or revocation of a retired instance.
---

# Decommission an application

Determine which records must survive removal and where their retained copies exist. An empty outbox establishes that no unresolved delivery remains in it. Local records and attachments can still require a backup.

`app uninstall --purge` runs the installed release's drain command before deleting its data directory. The release must verify against the supplied publisher key. Unresolved effects block purge.

## Preparation

A build's shelf life provides an operational date. Set `shelfLifeDays` in the application manifest when changing that lifetime, and read the installed value through `app status --trust <public-key-file>`. Passing the best-before date does not stop commands. Do not introduce ownership or renewal records as part of removal.

Resolve held effects through the running application's reconciliation interface. Review required retention for its workspace and blob data. Retain its audit files where the deployment requires them. A CSV list export omits data needed for a complete workspace backup.

## Local removal

Stop the service before opening its workspace with an embedded maintenance command. Run `app drain` with the installed service's `--workspace`, `--deployment-policy` and `--audit-log`. Keep the workspace while drain reports unresolved deliveries. Inspect its per-target counts and restart the application when delivery or reconciliation needs the serving host.

Once the required backup is retained, run:

```sh
app uninstall --purge --trust <public-key-file> --apply
```

For a staged installation, pass the same `--prefix` used at install. Purge invokes that installed release's drain with the installer's rights. Use `--discard-undelivered` only when deleting the reported unresolved effects is explicitly intended; inspect its returned deletion counts.

A normal `app uninstall` keeps the data directory. Desktop removal also retains Electron's workspace under `userData`; close its window before draining or copying that data. A paired device must deliver the records required at its hub before its credential is revoked and the operating system removes its sandbox.

## Hosted and connected installations

A hosted instance delivers while serving. Inspect unresolved effects through the running host before stopping it. Its database requires the deployment's own backup and removal procedure. Local purge cannot remove a hosted workspace. Account for the instance's local run history and audit files as well.

Revoke fleet or peer enrollment before removing associated instance records, so the retired installation cannot reconnect. Use the configured fleet service's removal operation. Close external accounts assigned solely to the removed installation.

## Checks

```sh
bun test plugins/deployment/test/install.test.ts
bun test packages/kernel/test/build.test.ts
```

A change to purge behavior must preserve the install suite's unresolved-delivery refusal and explicit discard cases. Record removal on a real host with its platform in [Implementation status](../../../../docs/implementation-status.md#install). Consult [Deployment and operation](../../../../docs/hosting.md#decommissioning-procedure) for the lifecycle contract and [deploy-an-application](../deploy-an-application/SKILL.md) for installation.
