import type { TargetCursor } from '@tortoise/integration';
import type { TestRequestsState } from '@tortoise/pattern-base/server';
import type { Publication } from './contracts';

/** The integration principal of the LIMS; it holds no lab role. */
export const LIMS_PRINCIPAL = 'lims-integration';

/** Publications and the inbound position, next to the base pattern's `testRequests` slice. */
export interface PublishingState {
  publications: Record<string, Publication>;
  sync: TargetCursor;
}

export interface LabPublishingRoot {
  testRequests: TestRequestsState;
  publishing: PublishingState;
}
