import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/session';
import { operations } from '../../contracts';
import { LocalStatusBadge, type LocalStatus } from '../local-status';

/**
 * Follow one CRM account, or show where it stands. The status comes from the live account list,
 * so it moves from requested to following (or refused) without a new search.
 */
export function FollowButton({
  externalId,
  name,
  status,
}: {
  externalId: string;
  name: string;
  status: LocalStatus;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  if (status !== 'none' && status !== 'rejected') return <LocalStatusBadge status={status} />;
  const follow = async () => {
    setPending(true);
    setError(undefined);
    try {
      await client.command(operations.accountFollow, { externalId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not follow');
    } finally {
      setPending(false);
    }
  };
  return (
    <span className="flex items-center gap-2">
      {status === 'rejected' && <LocalStatusBadge status="rejected" />}
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={follow}
        aria-label={`Follow ${name}`}
      >
        {status === 'rejected' ? 'Try again' : 'Follow'}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
