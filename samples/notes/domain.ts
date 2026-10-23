import type { Note } from './contracts';

/** Workspace roles: editors add and change notes, viewers read them. */
export type Role = 'editor' | 'viewer';

/** The notes slice of a workspace. */
export interface NotesState {
  /** People who work in this workspace and their role. */
  members: Record<string, Role>;
  notes: Record<string, Note>;
}

/** A new notes slice. Its owner is always an editor. */
export function createNotesState(ownerId: string, members: Record<string, Role> = {}): NotesState {
  return { members: { ...members, [ownerId]: 'editor' }, notes: {} };
}
