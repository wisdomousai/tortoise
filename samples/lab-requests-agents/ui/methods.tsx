import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { approvalOperations } from '@agent-native/contracts';
import { requestOperations } from '@agent-native/sample-lab-requests/contracts';
import { ApprovalReview } from '@/components/approval-review';
import { Button } from '@/components/ui/button';
import { live } from '@/lib/session';
import { useUiSession } from '@/lib/ui-session';
import { methodFor } from '../method';

type UiSession = ReturnType<typeof useUiSession>;
type RequestRecord = {
  id: string;
  specimen: string;
  description: string;
  method: string;
  revision: number;
};

const describe = (approval: { input: unknown }) =>
  `Test method: ${String((approval.input as { method?: unknown }).method ?? '')}`;

/**
 * Start an offline run from this screen. The deterministic harness plays the calls a model would
 * make: request approval for the method, then ask the technician to review it here. The run
 * carries the UI session, so it may send intents only to this screen.
 */
async function suggestMethod(request: RequestRecord, ui: UiSession) {
  const resource = `test-request:${request.id}`;
  const script = {
    commands: [
      {
        operation: approvalOperations.approvalRequest.id,
        input: {
          input: {
            operation: requestOperations.requestUpdate.id,
            input: { id: request.id, method: methodFor(request.description) },
            rationale: 'The test its description names.',
            resource,
            baseRevisions: { [resource]: request.revision },
          },
        },
      },
      {
        operation: 'ui.request-review',
        input: {
          input: {
            title: 'Review the suggested test method',
            operations: [requestOperations.requestUpdate.id],
          },
        },
      },
    ],
  };
  const captured = await ui.prepare();
  const response = await fetch('/api/v1/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      harnessId: 'deterministic',
      prompt: JSON.stringify(script),
      uiSessionId: captured.sessionId,
      uiContextVersion: captured.version,
    }),
  });
  if (!response.ok) throw new Error('Unable to start run');
}

/** The review a run asked for, with links to the records it names. */
function ReviewRequest({
  review,
  ui,
}: {
  review: NonNullable<UiSession['review']>;
  ui: UiSession;
}) {
  return (
    <div className="space-y-2 rounded-xl border-2 border-warning/60 p-3">
      <h3 className="font-medium">{review.title}</h3>
      <p className="text-sm text-muted-foreground">{review.operations.join(', ')}</p>
      {review.resources.length > 0 && (
        <ul className="text-sm">
          {review.resources.map((resource) => (
            <li key={resource}>
              <Link to="/approvals" className="underline">
                {resource}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void ui.acknowledgeReview(true)}>
          Acknowledge review
        </Button>
        <Button size="sm" variant="outline" onClick={() => void ui.acknowledgeReview(false)}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

/**
 * Added below the base sample's test request screen: suggested methods and the run that
 * suggests one.
 */
export function MethodSuggestions({ id }: { id: string }) {
  const query = useQuery(live.liveQueryOptions(requestOperations.requestGet, { id } as never));
  const request = query.data as RequestRecord | undefined;
  const ui = useUiSession(
    request ? { id: `test-request:${request.id}`, revision: request.revision } : undefined,
  );
  const [error, setError] = useState<string>();
  return (
    <section aria-label="Method suggestions" className="space-y-4">
      {ui.review && <ReviewRequest review={ui.review} ui={ui} />}
      <ApprovalReview
        title="Suggested test methods"
        list={approvalOperations.approvalList}
        approve={approvalOperations.approvalApprove}
        reject={approvalOperations.approvalReject}
        resource={`test-request:${id}`}
        describe={describe}
      />
      {request && !request.method && methodFor(request.description) && (
        <Button
          variant="outline"
          onClick={() =>
            void suggestMethod(request, ui).then(
              () => setError(undefined),
              (failure: Error) => setError(failure.message),
            )
          }
        >
          Suggest a method (offline run)
        </Button>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

/** Every pending approval request, where a review's links lead. */
export function Approvals() {
  return (
    <ApprovalReview
      title="Approval requests"
      list={approvalOperations.approvalList}
      approve={approvalOperations.approvalApprove}
      reject={approvalOperations.approvalReject}
      describe={describe}
    />
  );
}
