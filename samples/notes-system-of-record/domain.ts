import type { TargetCursor } from '@agent-native/integration';
import type { NotesState } from '@agent-native/sample-notes/server';
import type { Publication } from './contracts';

/** The integration principal of the publisher; it holds no notes role. */
export const PUBLISHER_PRINCIPAL = 'publisher-integration';

/** Publications and the feed position, next to the base sample's `notes` slice. */
export interface PublishingState {
  publications: Record<string, Publication>;
  sync: TargetCursor;
}

export interface NotesPublishingRoot {
  notes: NotesState;
  publishing: PublishingState;
}
