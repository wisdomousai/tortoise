/**
 * The storage schema version every storage adapter writes. Version 3 renamed stored fields: an
 * effect's `settledAt` became `completedAt`, the `upstream` phase became `acknowledged` and
 * `upstreamRef` became `externalRef`, among others. No adapter reads a workspace written before
 * it, so an older one is refused instead of read with the wrong names.
 */
export const STORAGE_SCHEMA_VERSION = 3;

/** The refusal for a database that another schema version wrote. */
export function schemaVersionError(found: number): Error {
  return new Error(
    found < STORAGE_SCHEMA_VERSION
      ? `Unsupported storage schema version ${found}: version ${STORAGE_SCHEMA_VERSION} renamed stored fields and does not read older workspaces. Start with a new data directory.`
      : `Unsupported storage schema version ${found}`,
  );
}
