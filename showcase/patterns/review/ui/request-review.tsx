import { useQuery } from '@tanstack/react-query';
import { requestOperations } from '@tortoise/pattern-base/contracts';
import { live } from '@/lib/session';
import { ReviewPanel } from '../features/review/screens';

/** The review panel for one test request, at the revision the request screen shows. */
export function RequestReview({ id }: { id: string }) {
  const request = useQuery(live.liveQueryOptions(requestOperations.requestGet, { id }));
  if (!request.data) return null;
  return <ReviewPanel subject={`test-request:${id}`} revision={request.data.revision} />;
}
