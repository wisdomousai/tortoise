---
'@tortoise/kernel': minor
'@tortoise/host': minor
'@tortoise/frame': minor
'@tortoise/bundle': minor
'@tortoise/site': minor
'@tortoise/fleet-agent': minor
'@tortoise/compliance': minor
'@tortoise/audit': minor
'@tortoise/scaffold': minor
---

Best-before dates. A manifest's `shelfLifeDays` and the build time a build stamps give each build a best-before date, which a site bundle signs. Hosts report it in the `listening` record and `GET /api/v1/build`, the web frame's app shell shows it with a notice once it passes, the audit log's `config.loaded` event includes it, the compliance posture adds a `best-before` check that warns and never fails, and fleet-agent reports include `bestBefore`. Nothing is refused after the date. A fleet older than this release refuses reports that include `bestBefore`, so upgrade a fleet before its sites. `scaffold new` sets a shelf life of 180 days.

The site plugin's install verbs move to the top level of the application's CLI: `app install`, `app status` and `app uninstall` replace `app site install`, `app site status` and `app site uninstall`. `site check` stays. `app uninstall --purge --trust <keys>` runs the installed release's own `drain` first and refuses while its outbox holds effects; `--discard-undelivered` purges anyway and lists what it deleted. `bundle create` on macOS no longer names the binary `.exe`.
