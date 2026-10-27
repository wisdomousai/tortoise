# Application lifecycle

An [application](glossary.md#application) built on the [framework](glossary.md#framework) serves one task at one [site](glossary.md#site) until the site removes it. Each build carries a best-before date that the host, the site install, the compliance posture and the fleet show, and nothing is refused after it. Removing an application deletes its data directory only after the [outbox](glossary.md#outbox) holds no effect that a [system of record](glossary.md#system-of-record) has not settled.

## Concepts

Terms: [shelf life](glossary.md#shelf-life), [best-before date](glossary.md#best-before-date) and [decommissioning](glossary.md#decommissioning).

## Shelf life and best-before date

The manifest declares the shelf life as a whole number of days, and `defineManifest` refuses any other value. An application without one builds releases without a best-before date.

A build stamps the time it was made. `scripts/application-entry.ts` writes the entry that `bun run build:cli`, the desktop sidecar build and `bun run bundle create` compile, and the entry stamps the definition with the build time (`packages/kernel/src/build.ts`). A run from source has no stamp and no date. The best-before date is the build date plus the shelf life, in UTC, and it is the last day within the shelf life.

`bun run bundle create` stamps the binary and the [site bundle](glossary.md#site-bundle) with the same time and signs the date into `bundle.json`. A new release therefore carries a new date, and a changed date fails verification.

The date shows in these places:

| Where | What shows |
| --- | --- |
| `serve` | `build` in the `listening` record |
| `GET /api/v1/build` | The build time, shelf life, date and whether it has passed, for a session |
| Web frame | "Best before" and the date in the panel's status box, and a notice from the day after |
| Audit log | The build time and date in `config.loaded` |
| `site status` | `bestBefore` and `pastBestBefore` of the verified release |
| Compliance posture | The `best-before` check: `pass`, then `warn` from 30 days before the date |
| Fleet health | The `past-best-before` state |

The posture check reports `info` for a build without a date and never `fail`. Commands keep committing, `site install` admits a bundle past its date, and the service keeps running.

## What decommissioning removes

An effect waiting in the outbox exists only in the workspace. Once the outbox is empty and every [held effect](systems-of-record.md#held-effects) is decided, the systems of record hold every record a target receives. Records no target receives, the [audit log](glossary.md#audit-log) and the blobs exist only in the data directory, `var/lib/agent-native/<app>` on a site.

`site uninstall --purge` runs the installed release's own `drain` before it removes anything. It verifies that release against the keys given with `--trust`, because the binary runs with the installer's rights. The release knows its targets and effect types, which the binary running the uninstall may not. With `--apply` the service stops first, and without it a running service owns the workspace and `drain` refuses.

`drain` delivers what it can and then counts what remains for each target: pending effects, held effects and effects awaiting the target's decision. While any remain, the purge is refused with `CONFLICT` and the counts in the error details, and every file stays in place. `--discard-undelivered` purges anyway and lists the deleted counts in the result. `plugins/site/test/install.test.ts` covers the refusal, a purge after the target settles, and the override.

## Decommissioning procedure

Here `app` stands for the application's CLI and `<app>` for its ID.

1. Decide each held effect on the application's reconciliation screen while the service runs.
2. Stop the service:

   ```sh
   systemctl stop agent-native-<app>.service
   ```

3. Deliver what remains, and repeat until `drain` exits 0:

   ```sh
   app drain --workspace /var/lib/agent-native/<app>/workspace --site-policy /etc/agent-native/<app>/site-policy.json --audit-log /var/lib/agent-native/<app>/audit
   ```

4. Copy `/var/lib/agent-native/<app>` when a retention rule covers its records or audit log.
5. Remove the service, the releases and the data:

   ```sh
   app site uninstall --purge --trust key.pub.json --apply
   ```

6. On the fleet, revoke the site's device on the Devices screen, then remove the site on its Sites screen.
7. On each peer application that enrolled this one, revoke it with `peer.revoke`.
8. Close the accounts at the systems of record that the security manifest's destinations name.

A desktop installation keeps its workspace under Electron's `userData` directory. Close the window, run `drain` on that workspace, copy it when retention applies, delete it, and uninstall the application through the OS.

A paired phone hands its records to its hub. Open the application until its records reach the hub, revoke the device on the hub's Devices screen, then uninstall the application. The OS deletes its sandbox with the workspace.

A hosted instance delivers while it serves, and its fleet report counts what remains. Stop it once the report shows nothing pending or held, then drop its workspace from the database with the database's own tools.

## Limits

- The framework records no owner, term, approval or renewal for an application.
- Mobile builds carry no build stamp and no best-before date.
- No desktop uninstaller removes the workspace.
- `drain` and the purge check open a workspace directory, not a hosted workspace.
- Records that no target receives leave the application only in a workspace backup or a copy of the data directory, with no export format of their own.

## References

- [Hosting](hosting.md)
- [Security and compliance](security-and-compliance.md)
- [Systems of record](systems-of-record.md)
- [Desktop](desktop.md)
- [Mobile](mobile.md)
- [Implementation status](implementation-status.md#application-lifecycle)
- [`@agent-native/site`](../plugins/site/README.md)
- [decommission-an-application](../plugins/site/skills/decommission-an-application/SKILL.md)
- [deploy-to-site](../plugins/site/skills/deploy-to-site/SKILL.md)
