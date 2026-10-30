---
name: decommission-an-application
description: Remove an agent-native application from a site without losing records, or give an application a shelf life. Use when retiring or uninstalling an application, purging its data directory with app uninstall --purge, a purge refused because the outbox still holds effects, deciding held effects before removal, removing a site from a fleet with site.remove, or setting shelfLifeDays and reading the best-before date in app status, posture or fleet health. Covers plugins/site, packages/kernel/src/build.ts and showcase/examples/fleet.
---

# Decommission an application

An application keeps records its systems of record have not completed only in its workspace. Decommissioning delivers or decides them, then deletes the data directory. `app uninstall --purge` refuses while the installed release's `drain` still counts pending, held or acknowledged effects.

## Before writing

- The site decides when an application goes. Add no owner, term, approval or renewal record to an application, and refuse nothing because a build is past its best-before date.
- A [held effect](../../../../docs/systems-of-record.md#held-effects) waits for a person's decision, which only the running instance records. Decide held effects before the service stops.
- The purge check runs the installed release's binary, so it needs the publisher keys that `app install` used.
- Records no target receives, the audit log and the blobs exist only in the data directory.

## Steps

1. Give the application a shelf life: set `shelfLifeDays` in its manifest. The scaffold writes 180.
2. Read the best-before date of an installed release with `app status --trust key.pub.json`.
3. Decide each held effect on the application's reconciliation screen while the service runs.
4. Stop the service, then run `app drain` with the service's `--workspace`, `--site-policy` and `--audit-log` until it exits 0.
5. Copy `var/lib/agent-native/<app>` when a retention rule covers its records or audit log.
6. Run `app uninstall --purge --trust key.pub.json --apply`, with the install's `--prefix` for a staged install. The purge runs the release's drain itself and refuses while effects remain.
7. When the purge is refused, read the per-target counts in the error details. Start the service to deliver or decide them, then repeat from step 3.
8. Pass `--discard-undelivered` only when the remaining effects may be lost. The result lists what was deleted.
9. On the fleet, revoke the site's device, then call `site.remove` from the site's screen.
10. Revoke this application on each peer application with `peer.revoke`, and close the system-of-record accounts that its destinations name.

## Checks

1. Run the tests:

   ```sh
   bun test plugins/site/test/install.test.ts
   bun test packages/kernel/test/build.test.ts
   bun test showcase/examples/fleet
   ```

2. A change to the purge check keeps the install tests' refusal, complete and override cases.
3. Record a decommissioning on a real site host in [implementation status](../../../../docs/implementation-status.md#install), with its platform.

## References

- [Application lifecycle](../../../../docs/application-lifecycle.md)
- [`@agent-native/site`](../../README.md)
- [deploy-to-site](../deploy-to-site/SKILL.md)
- [connect-a-site-to-a-fleet](../../../fleet-agent/skills/connect-a-site-to-a-fleet/SKILL.md)
