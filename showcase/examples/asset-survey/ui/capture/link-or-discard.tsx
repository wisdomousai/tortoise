import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCommand } from '@tortoise/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { live, transport } from '@/lib/session';
import { operations } from '../../contracts';
import { ErrorText, quietly } from '../shared';

/**
 * Put a capture on the right node of its survey, found by designation or name, or discard it
 * with a reason. An unlinked capture can also be linked and sent to the model in one step, or
 * handed to the capture-to-EAM workflow, which also files and exports the node once its values
 * are accepted.
 */
export function LinkOrDiscard({ captureId, linked }: { captureId: string; linked: boolean }) {
  const [q, setQ] = useState('');
  const [reason, setReason] = useState('');
  const found = useQuery({
    ...live.liveQueryOptions(operations.nodeSearch, { q, limit: 8 }),
    enabled: q.trim().length > 0,
  });
  const link = useCommand(transport, operations.reportLink!);
  const linkAndExtract = useCommand(transport, operations.linkAndExtract);
  const linkAndFile = useCommand(transport, operations.captureFileWorkflow);
  const busy = link.pending || linkAndExtract.pending || linkAndFile.pending;
  const discard = useCommand(transport, operations.reportDiscard);
  return (
    <section
      aria-label={linked ? 'Relink or discard' : 'Link'}
      className="space-y-3 rounded-xl border bg-card p-4"
    >
      <Input
        aria-label="Find node"
        placeholder={
          linked ? 'Link to another node: designation or name' : 'Designation or name of the node'
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
                  disabled={busy}
                  onClick={() =>
                    void quietly(
                      link.execute({ id: captureId, subject: node.id }).then(() => setQ('')),
                    )
                  }
                >
                  Link here
                </Button>
                {!linked && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void quietly(
                        linkAndExtract
                          .execute({ id: captureId, nodeId: node.id })
                          .then(() => setQ('')),
                      )
                    }
                  >
                    Link and extract
                  </Button>
                )}
                {!linked && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void quietly(
                        linkAndFile
                          .execute({ id: captureId, nodeId: node.id })
                          .then(() => setQ('')),
                      )
                    }
                  >
                    Link and file
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
      <ErrorText error={link.error ?? linkAndExtract.error ?? linkAndFile.error ?? discard.error} />
    </section>
  );
}
