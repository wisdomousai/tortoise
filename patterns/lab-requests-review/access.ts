import { own } from '@agent-native/runtime';
import type { LabRequestsRoot } from '@agent-native/pattern-lab-requests/application';
import type { ReviewAccess } from './features/review/feature';

const prefix = 'test-request:';

/**
 * Who may review in the lab: members read signatures and technicians sign. Only test requests
 * are subjects, and a request's author is the technician who submitted it.
 */
export const reviewAccess = ({ labRequests }: LabRequestsRoot): ReviewAccess => ({
  allows(context, action) {
    const role = own(labRequests.members, context.principalId);
    return action === 'read' ? role !== undefined : role === 'technician';
  },
  authorOf(subject) {
    if (!subject.startsWith(prefix)) return undefined;
    return own(labRequests.requests, subject.slice(prefix.length))?.requester;
  },
});
