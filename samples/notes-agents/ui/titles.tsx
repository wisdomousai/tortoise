import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { approvalOperations } from '@agent-native/contracts';
import { noteOperations } from '@agent-native/sample-notes/contracts';
import { ApprovalReview } from '@/components/approval-review';
import { Button } from '@/components/ui/button';
import { live } from '@/lib/session';
import { useUiSession } from '@/lib/ui-session';
import { titleFrom } from '../title';

type UiSession = ReturnType<typeof useUiSession>;
type NoteRecord = { id: string; title: string; text: string; revision: number };

const describe = (approval: { input: unknown }) =>
  `Title: ${String((approval.input as { title?: unknown }).title ?? '')}`;

/**
 * Start an offline run from this screen. The deterministic harness plays the calls a model would
 * make: request approval for the title, then ask the person to review it here. The run carries
 * the UI session, so it may send intents only to this screen.
 */
async function suggestTitle(note: NoteRecord, ui: UiSession) {
  const resource = `note:${note.id}`;
  const script = {
    commands: [
      {
        operation: approvalOperations.approvalRequest.id,
        input: {
          input: {
            operation: noteOperations.noteUpdate.id,
            input: { id: note.id, title: titleFrom(note.text) },
            rationale: 'The first line of the text.',
            resource,
            baseRevisions: { [resource]: note.revision },
          },
        },
      },
      {
        operation: 'ui.request-review',
        input: { input: { title: 'Review the suggested title', operations: ['note.update'] } },
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

/** Added below the base sample's note screen: suggested titles and the run that suggests one. */
export function TitleSuggestions({ id }: { id: string }) {
  const query = useQuery(live.liveQueryOptions(noteOperations.noteGet, { id } as never));
  const note = query.data as NoteRecord | undefined;
  const ui = useUiSession(note ? { id: `note:${note.id}`, revision: note.revision } : undefined);
  const [error, setError] = useState<string>();
  return (
    <section aria-label="Title suggestions" className="space-y-4">
      {ui.review && <ReviewRequest review={ui.review} ui={ui} />}
      <ApprovalReview
        title="Suggested titles"
        list={approvalOperations.approvalList}
        approve={approvalOperations.approvalApprove}
        reject={approvalOperations.approvalReject}
        resource={`note:${id}`}
        describe={describe}
      />
      {note && !note.title && titleFrom(note.text) && (
        <Button
          variant="outline"
          onClick={() =>
            void suggestTitle(note, ui).then(
              () => setError(undefined),
              (failure: Error) => setError(failure.message),
            )
          }
        >
          Suggest a title (offline run)
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
