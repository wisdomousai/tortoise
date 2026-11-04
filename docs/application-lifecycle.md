# Application lifecycle

A production build reports a best-before date from the application's declared shelf life. The host warns after that date and continues to run commands. A replacement release gets a new date.

Removal depends on records still waiting for delivery. The uninstall command drains the outbox and refuses the purge while effects remain unresolved. Records kept only in the application need a backup before removal.

## Shelf life and best-before date

The manifest declares the shelf life as a whole number of days; `defineManifest` refuses any other value. An application without one builds releases without a best-before date.

A build stamps its time. `scripts/application-entry.ts` writes the entry these commands compile:

- `bun run build:cli`
- the desktop sidecar build
- `bun run bundle create`

The entry stamps the definition with the build time (`packages/kernel/src/build.ts`). A run from source has no stamp and no date. The best-before date is build date plus shelf life, in UTC — the last day within the shelf life.

`bun run bundle create` stamps the binary and the site bundle with the same time and signs the date into `bundle.json`. A new release records a new date. A changed date fails verification.

The date shows in these places:

| Where | What shows |
| --- | --- |
| `serve` | `build` in the `listening` record |
| `GET /api/v1/build` | The build time, shelf life, date and whether it has passed, for a session |
| Web frame | "Best before" and the date in the panel's status box, and a notice from the day after |
| Audit log | The build time and date in `config.loaded` |
| `app status` | `bestBefore` and `pastBestBefore` of the verified release |
| Compliance posture | The `best-before` check: `pass`, then `warn` from 30 days before the date |
| Fleet health | The `past-best-before` state |

The posture check reports `info` for a build without a date, never `fail`. Commands keep committing, `app install` admits a bundle past its date, and the service keeps running.

## What decommissioning removes

An effect in the outbox exists only in the workspace. Once the outbox is empty and a person has decided every held effect, the systems of record store every record a target receives.

What exists only in the data directory (`var/lib/tortoise/<app>` on a site):

- Records that no target receives
- The audit log
- The blobs

`app uninstall --purge` runs the installed release's own `drain` before removing anything, verifying that release against the keys given with `--trust` — the binary runs with the installer's rights. The release knows its targets and effect types, which the uninstalling binary may not. With `--apply` the service stops first; without it, a running service owns the workspace and `drain` refuses.

`drain` delivers what it can and then counts what remains for each target:

- Pending effects
- Held effects
- Effects awaiting the target's decision

While any remain, the purge fails with `CONFLICT` and the counts in the error details — every file stays in place. `--discard-undelivered` purges anyway and lists the deleted counts in the result. `plugins/site/test/install.test.ts` covers the refusal, a purge after the target completes, and the override.

## Decommissioning procedure

Here `app` stands for the application's CLI and `<app>` for its ID.

1. Decide each held effect on the application's reconciliation screen while the service runs.
2. Stop the service:

   ```sh
   systemctl stop tortoise-<app>.service
   ```

3. Deliver what remains, and repeat until `drain` exits 0:

   ```sh
   app drain --workspace /var/lib/tortoise/<app>/workspace --site-policy /etc/tortoise/<app>/site-policy.json --audit-log /var/lib/tortoise/<app>/audit
   ```

4. Copy `/var/lib/tortoise/<app>` when a retention rule covers its records or audit log.
5. Remove the service, the releases and the data:

   ```sh
   app uninstall --purge --trust key.pub.json --apply
   ```

6. On the fleet, revoke the site's device on the Devices screen, then remove the site on its Sites screen.
7. On each peer application that enrolled this one, revoke it with `peer.revoke`.
8. Close the accounts at the systems of record that the security manifest's destinations name.

A desktop installation keeps its workspace under Electron's `userData` directory. Close the window, run `drain` on that workspace, copy it when retention applies, delete it, and uninstall the application through the OS.

A paired phone hands its records to its hub. Open the application until its records reach the hub, revoke the device on the hub's Devices screen, then uninstall. The OS deletes the sandbox with the workspace.

A hosted instance delivers while it serves, and its fleet report counts what remains. Stop it once the report shows nothing pending or held, then drop its workspace from the database with the database's own tools.

## Limits

- The framework records no owner, term, approval or renewal for an application.
- Mobile builds have no build stamp and no best-before date.
- No desktop uninstaller removes the workspace.
- `drain` and the purge check open a workspace directory, not a hosted workspace.
- Records that no target receives leave the application only in a workspace backup, a copy of the data directory or a CSV export of a list, which the collection screen and the CLI's `--output csv` write. CSV keeps no history and no attachments.

## References

- [Hosting](hosting.md)
- [Security and compliance](security-and-compliance.md)
- [Systems of record](systems-of-record.md)
- [Desktop](desktop.md)
- [Mobile](mobile.md)
- [Implementation status](implementation-status.md#application-lifecycle)
- [`@tortoise/site`](../plugins/site/README.md)
- [decommission-an-application](../plugins/site/skills/decommission-an-application/SKILL.md)
- [deploy-to-site](../plugins/site/skills/deploy-to-site/SKILL.md)
