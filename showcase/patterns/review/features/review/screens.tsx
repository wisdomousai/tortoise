import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { defineFeatureScreens } from '@tortoise/frame/feature-screens';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { client, live } from '@/lib/session';
import { reviewOperations, type Review } from './contracts';

const refusal = (error: unknown) => {
  const { code, message } = error as { code?: string; message?: string };
  // A denial carries the policy's reason as its message.
  if (code === 'FORBIDDEN' && message === 'SELF_REVIEW')
    return 'You wrote this record, so someone else signs it.';
  if (code === 'FORBIDDEN') return 'You may not sign this record.';
  if (code === 'CONFLICT')
    return 'The record changed or you signed this revision already. Nothing was signed.';
  return error instanceof Error ? error.message : 'The review failed.';
};

function Signature({ review, revision }: { review: Review; revision: number }) {
  return (
    <li className="space-y-1 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={review.verdict === 'approved' ? 'default' : 'destructive'}>
          {review.verdict === 'approved' ? 'Approved' : 'Rejected'}
        </Badge>
        <span className="font-medium">{review.reviewer}</span>
        <span className="text-muted-foreground">revision {review.revision}</span>
        {review.revision !== revision && <Badge variant="outline">Earlier revision</Badge>}
      </div>
      {review.comment && <p className="whitespace-pre-wrap">{review.comment}</p>}
    </li>
  );
}

/**
 * The signatures on one record and the form to approve or reject it at `revision`, the revision
 * the screen shows. A signature passes that revision as its precondition, so a record changed in
 * between is refused with CONFLICT instead of being signed unseen.
 */
export function ReviewPanel({ subject, revision }: { subject: string; revision: number }) {
  const reviews = useQuery(live.liveQueryOptions(reviewOperations.reviewList, { subject }));
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const sign = async (verdict: Review['verdict']) => {
    setBusy(true);
    setMessage(undefined);
    try {
      await client.command(
        reviewOperations.reviewSign,
        { subject, verdict, comment: comment.trim() },
        { expectedRevisions: { [subject]: revision } },
      );
      setComment('');
    } catch (error) {
      setMessage(refusal(error));
    } finally {
      setBusy(false);
    }
  };
  const items = reviews.data?.items ?? [];
  return (
    <section aria-label="Review" className="space-y-3">
      <h2 className="text-lg font-semibold">Review</h2>
      {items.length ? (
        <ul className="space-y-2">
          {items.map((review) => (
            <Signature key={review.id} review={review} revision={revision} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No one has signed this record.</p>
      )}
      <Textarea
        aria-label="Review comment"
        placeholder="Comment"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => sign('approved')}>
          Approve
        </Button>
        <Button disabled={busy} variant="outline" onClick={() => sign('rejected')}>
          Reject
        </Button>
      </div>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </section>
  );
}

/**
 * The review feature's screens. It adds no route of its own: the application places
 * `ReviewPanel` on the screen of the record it reviews and names that screen in `open`.
 */
export const reviewScreens = (options: { open: string }) =>
  defineFeatureScreens({
    id: 'review',
    routes: [],
    capabilityScreens: [{ prefix: 'review.', to: options.open }],
  });
