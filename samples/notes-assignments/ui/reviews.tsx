import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ClipboardCheck, Inbox } from 'lucide-react';
import { peerLinkOperations } from '@agent-native/peer-link/contracts';
import { AssignmentBoard, type AssigneeOption } from '@/components/assignment-board';
import { AssignmentReports } from '@/components/assignment-reports';
import { RecordScreen } from '@/components/collection-screen';
import { MyAssignments } from '@/components/my-assignments';
import { live } from '@/lib/session';
import { assignmentOperations, review, reviewOperations } from '../contracts';

type Peer = { id: string; label: string; application: string; revokedAt?: number };

/**
 * Members and the reviewer agent from the application, and connected peer applications from
 * the peer link. Only the workspace owner may list peers; for anyone else the list has none.
 */
function useAssignees(): AssigneeOption[] {
  const local = useQuery(live.liveQueryOptions(reviewOperations.assigneeList, {}));
  const peers = useQuery({
    ...live.liveQueryOptions(peerLinkOperations.list, {}),
    retry: false,
  });
  return [
    ...((local.data as { items: AssigneeOption[] } | undefined)?.items ?? []),
    ...((peers.data as { peers: Peer[] } | undefined)?.peers ?? [])
      .filter((peer) => peer.revokedAt === undefined)
      .map((peer) => ({ type: 'peer', id: peer.id, label: `${peer.label} (${peer.application})` })),
  ];
}

function Board() {
  return (
    <div className="space-y-8">
      <AssignmentBoard
        title="Reviews"
        list={assignmentOperations.list}
        withdraw={assignmentOperations.withdraw}
        close={assignmentOperations.close}
        kinds={[
          {
            kind: review,
            create: assignmentOperations.reviewCreate,
            send: assignmentOperations.reviewSend,
          },
        ]}
        assignees={useAssignees()}
        aside={(assignment) => (
          <Link className="text-sm underline" to={`/reviews/${assignment.id}`}>
            Reports
          </Link>
        )}
      />
      <Reports />
    </div>
  );
}

function Reports({ input }: { input?: Record<string, unknown> }) {
  return (
    <AssignmentReports
      list={assignmentOperations.reportList}
      discard={assignmentOperations.reportDiscard}
      place={assignmentOperations.reportPlace}
      kinds={[{ kind: review, accept: assignmentOperations.reviewAccept }]}
      {...(input ? { input } : {})}
    />
  );
}

function ReviewScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  return (
    <div className="space-y-8">
      <RecordScreen title="Review" get={assignmentOperations.get} />
      <Reports input={{ assignmentId: id }} />
    </div>
  );
}

function Mine() {
  return (
    <MyAssignments
      feed={assignmentOperations.feed}
      complete={assignmentOperations.complete}
      kinds={[{ kind: review, report: assignmentOperations.reviewReport }]}
    />
  );
}

/** The review board with its reports, one review with its reports, one report, and my reviews. */
export const reviewRoutes = [
  { path: 'reviews', component: Board },
  { path: 'reviews/$id', component: ReviewScreen },
  {
    path: 'reports/$id',
    component: () => <RecordScreen title="Report" get={assignmentOperations.reportGet} />,
  },
  { path: 'my-reviews', component: Mine },
];

export const reviewNavigation = [
  { to: '/reviews', label: 'Reviews', icon: ClipboardCheck },
  { to: '/my-reviews', label: 'My reviews', icon: Inbox },
];

export const reviewCapabilityScreens = [
  { prefix: 'assignment.review.report', to: '/my-reviews' },
  { prefix: 'assignment.complete', to: '/my-reviews' },
  { prefix: 'assignment.feed', to: '/my-reviews' },
  { prefix: 'assignment.', to: '/reviews' },
  { prefix: 'review.', to: '/reviews' },
];
