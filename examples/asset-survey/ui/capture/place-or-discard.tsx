import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCommand } from '@agent-native/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { live, transport } from '@/lib/session';
import { operations } from '../../contracts';
import { ErrorText, quietly } from '../shared';

/**
 * Put a capture on the right node, found by designation or name, or discard it with a reason. An
 * unplaced capture can also be placed and sent for extraction in one step.
 */
export function PlaceOrDiscard({ captureId, placed }: { captureId: string; placed: boolean }) {
  const [q, setQ] = useState('');
  const [reason, setReason] = useState('');
  const found = useQuery({
    ...live.liveQueryOptions(operations.nodeSearch, { q, limit: 8 }),
    enabled: q.trim().length > 0,
  });
  const place = useCommand(transport, operations.capturePlace);
  const placeAndExtract = useCommand(transport, operations.capturePlaceAndExtract);
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
              <span className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={place.pending || placeAndExtract.pending}
                  onClick={() =>
                    void quietly(
                      place.execute({ id: captureId, nodeId: node.id }).then(() => setQ('')),
                    )
                  }
                >
                  Place here
                </Button>
                {!placed && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={place.pending || placeAndExtract.pending}
                    onClick={() =>
                      void quietly(
                        placeAndExtract
                          .execute({ id: captureId, nodeId: node.id })
                          .then(() => setQ('')),
                      )
                    }
                  >
                    Place and extract
                  </Button>
                )}
              </span>
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
      <ErrorText error={place.error ?? placeAndExtract.error ?? discard.error} />
    </section>
  );
}
