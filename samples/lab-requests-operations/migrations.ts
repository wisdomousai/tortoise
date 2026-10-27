import type { StateMigrations } from '@agent-native/kernel/migrations';

type Stored = { labRequests?: { requests?: Record<string, Record<string, unknown>> } };

/** Version 1 field names and the version 2 names that the lab requests handlers read. */
const renamed = { sampleId: 'specimen', tests: 'method' } as const;

/**
 * Version 2 of the application's state. An earlier release of the lab requests module stored a
 * request's specimen as `sampleId` and its test method as `tests`; the step renames both. The
 * step is not compatible: code at version 1 would read a request without `sampleId`, so storage
 * refuses that code once a workspace is at version 2.
 *
 * A version 1 workspace that `samples/lab-requests` wrote already holds `specimen` and `method`.
 * The step leaves those requests unchanged, so it is deterministic on both kinds of version 1
 * state.
 */
export const labRequestsMigrations: StateMigrations = {
  version: 2,
  steps: [
    {
      from: 1,
      to: 2,
      up(state) {
        const stored = structuredClone(state ?? {}) as Stored;
        for (const request of Object.values(stored.labRequests?.requests ?? {}))
          for (const [from, to] of Object.entries(renamed))
            if (from in request) {
              request[to] = request[from] ?? '';
              delete request[from];
            }
        return stored;
      },
    },
  ],
};
