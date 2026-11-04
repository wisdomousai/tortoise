---
'@tortoise/runtime': minor
'@tortoise/adapters': minor
'@tortoise/host': minor
'@tortoise/testing': patch
---

Staged uploads survive a restart, and hosted instances keep blobs in Postgres. `BlobStore` gains optional `stage`, `stagedUntil` and `unstage`; the runtime records each upload there, so its uploader can still attach it within the grace period after a restart, and the sweep forgets ended staging. The file and memory stores implement them; the file store names each record by the SHA-256 of its key. `createPostgresBlobStore` in `@tortoise/adapters/postgres-blobs` keeps blobs in `workspace_blobs` (`BYTEA`) and staging in `workspace_blob_staging`, checks the lease fence before a removal, and reads a blob missing there from a fallback store and copies it in. The hosted platform uses it with the local directory as the fallback. The PGlite test driver runs a transaction begun inside another on the open one.
