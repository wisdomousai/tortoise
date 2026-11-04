---
'@tortoise/contracts': minor
'@tortoise/adapters': minor
'@tortoise/frame': minor
---

CSV export and a print view. `csvText`, `csvColumns` and `readAllPages` in `@tortoise/contracts` write rows as RFC 4180 CSV and read a list query page by page; a text cell that starts like a formula gets a leading apostrophe. The CLI's `--output csv` prints every row of a list query with its filters. `CollectionScreen` adds Export CSV for the rows the current filters, search and sort match, with the screen's columns. `RecordScreen` adds Print and a `sections` prop for the application's own parts; the print layout shows the heading, the fields and the sections, without the forms, the sidebar or the aside.
