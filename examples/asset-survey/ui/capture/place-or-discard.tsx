import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCommand } from '@agent-native/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { live, transport } from '@/lib/session';
import { operations } from '../../contracts';
import { ErrorText, quietly } from '../shared';

/** Put a capture on the right node, found by designation or name, or discard it with a reason. */
export function PlaceOrDiscard({ captureId, placed }: { captureId: string; placed: boolean }) {
  const [q, setQ] = useState('');
  const [reason, setReason] = useState('');
  const found = useQuery({
    ...live.liveQueryOptions(operations.nodeSearch, { q, limit: 8 }),
    enabled: q.trim().length > 0,
  });
  const place = useCommand(transport, operations.capturePlace);
  const discard = useCommand(transport, operations.captureDiscard);
  return (
    <section
      aria-label={placed ? 'Move or discard' : 'Place'}
      className="space-y-3 rounded-xl border bg-card p-4"
    >
      <Input
        aria-label="Find node"
        placeholder={
          placed ? 'Move to another node: designation or name' : 'Designation or name of the node'
        }
        value={q}
        onChange={(event) => setQ(event.target.value)}
      />
      {found.data && (
        <ul className="space-y-1 text-sm">
          {found.data.items.map((node) => (
            <li key={node.id} className="flex items-center justify-between gap-2">
              <span>
                <span className="font-mono">{node.designation}</span> {node.name}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={place.pending}
                onClick={() =>
                  void quietly(
                    place.execute({ id: captureId, nodeId: node.id }).then(() => setQ('')),
                  )
                }
              >
                Place here
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void quietly(discard.execute({ id: captureId, reason: reason.trim() }));
        }}
      >
        <Input
          aria-label="Reason to discard"
          placeholder="Blurred, wrong object, duplicate…"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={discard.pending || !reason.trim()}>
          Discard
        </Button>
      </form>
      <ErrorText error={place.error ?? discard.error} />
    </section>
  );
}
