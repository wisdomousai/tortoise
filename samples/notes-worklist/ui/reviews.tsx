import { Inbox } from 'lucide-react';
import { RecordScreen } from '@/components/collection-screen';
import { Worklist } from '@/components/worklist';
import { review, worklistOperations } from '../contracts';

function Reviews() {
  return (
    <Worklist
      title="Reviews to do"
      list={worklistOperations.assignmentList}
      reports={worklistOperations.reportList}
      complete={worklistOperations.complete}
      status={worklistOperations.status}
      kinds={[{ kind: review, report: worklistOperations.reviewReport }]}
      issuer="notes-assignments"
    />
  );
}

/** The reviews held here with their reports, and one review. */
export const reviewRoutes = [
  { path: 'reviews', component: Reviews },
  {
    path: 'reviews/$id',
    component: () => <RecordScreen title="Review" get={worklistOperations.assignmentGet} />,
  },
];

export const reviewNavigation = [{ to: '/reviews', label: 'Reviews', icon: Inbox }];
export const reviewCapabilityScreens = [{ prefix: 'worklist.', to: '/reviews' }];
