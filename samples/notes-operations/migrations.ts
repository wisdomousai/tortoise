import type { StateMigrations } from '@agent-native/kernel/migrations';

type Stored = { notes?: { notes?: Record<string, Record<string, unknown>> } };

/**
 * Version 2 of the application's state. An earlier release of the notes module stored a note's
 * text as `body`; the step renames it to `text`, which the current handlers read. The step is not
 * compatible: code at version 1 would read a note without `body`, so storage refuses that code
 * once a workspace is at version 2.
 *
 * A version 1 workspace that `samples/notes` wrote already holds `text`. The step leaves those
 * notes unchanged, so it is deterministic on both kinds of version 1 state.
 */
export const notesMigrations: StateMigrations = {
  version: 2,
  steps: [
    {
      from: 1,
      to: 2,
      up(state) {
        const stored = structuredClone(state ?? {}) as Stored;
        for (const note of Object.values(stored.notes?.notes ?? {}))
          if ('body' in note) {
            note.text = note.body ?? '';
            delete note.body;
          }
        return stored;
      },
    },
  ],
};
