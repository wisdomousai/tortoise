import type { TargetCursor } from '@agent-native/integration';
import type { LabRequestsState } from '@agent-native/pattern-lab-requests/server';
import type { Publication } from './contracts';

/** The integration principal of the LIMS; it holds no lab role. */
export const LIMS_PRINCIPAL = 'lims-integration';

/** Publications and the feed position, next to the base pattern's `labRequests` slice. */
export interface PublishingState {
  publications: Record<string, Publication>;
  sync: TargetCursor;
}

export interface LabPublishingRoot {
  labRequests: LabRequestsState;
  publishing: PublishingState;
}
