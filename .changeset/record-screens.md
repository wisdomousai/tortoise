---
'@tortoise/contracts': minor
'@tortoise/runtime': minor
'@tortoise/react': minor
'@tortoise/frame': minor
'@tortoise/scaffold': minor
---

Record screens: `collectionList` takes `sort`, which adds `sortBy` and `sortDirection` inputs the list handler honours; `collectionUpdate` accepts `null` for a field the item may leave out, which clears it (`clearable`, `listSortFields`). Display fields have a `kind` (`date`, `date-time`, `status`, `reference`, `file`), `tones` and a `reference`, checked when the catalog builds.

The frame's `CollectionScreen` renders the declared filters, sort and search, formats cells by kind and opens rows through `screens.resources`; `RecordScreen` edits the record's values, clears emptied optional fields, confirms a retire and returns to `list`. `CapabilityForm` takes `initial` and renders date, date-time, checkbox, reference-picker and file inputs. `packages/frame/src/lib/fields.ts` and `references.ts` contain the shared field presentation; `useDebouncedValue` joins `@tortoise/react/hooks`. The scaffold declares sort, display kinds and a retire for every collection, and writes a browser test per collection.
