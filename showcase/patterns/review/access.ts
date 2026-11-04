import { own } from '@tortoise/runtime';
import type { TestRequestsRoot } from '@tortoise/pattern-base/application';
import type { ReviewAccess } from './features/review/feature';

const prefix = 'test-request:';

/**
 * Who may review in the lab: members read signatures and technicians sign. Only test requests
 * are subjects, and a request's author is the technician who submitted it.
 */
export const reviewAccess = ({ testRequests }: TestRequestsRoot): ReviewAccess => ({
  allows(context, action) {
    const role = own(testRequests.members, context.principalId);
    return action === 'read' ? role !== undefined : role === 'technician';
  },
  authorOf(subject) {
    if (!subject.startsWith(prefix)) return undefined;
    return own(testRequests.requests, subject.slice(prefix.length))?.requester;
  },
});
