import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AnyCapability } from '@agent-native/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { client, live } from '@/lib/session';

type Query = AnyCapability & { kind: 'query' };
type Command = AnyCapability & { kind: 'command' };
interface HeldEffect {
  id: string;
  target: string;
  type: string;
  resource: string;
  payload: unknown;
  heldAt: number;
  holdReason?: string;
  attempts: number;
}
type Decision = 'applied' | 'not-applied' | 'refused';

const refusal = (error: unknown) => {
  const code = (error as { code?: string }).code;
  if (code === 'NOT_FOUND') return 'Someone already decided this delivery, or you may not.';
  if (code === 'FORBIDDEN') return 'You may not reconcile deliveries.';
  return error instanceof Error ? error.message : 'The decision failed.';
};

function HeldItem({
  effect,
  resolve,
  describe,
}: {
  effect: HeldEffect;
  resolve: Command;
  describe?: (effect: HeldEffect) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string>();
  const decide = async (decision: Decision) => {
    setBusy(true);
    setMessage(undefined);
    const text = note.trim();
    const extra =
      text && decision === 'applied'
        ? { externalRef: text }
        : text && decision === 'refused'
          ? { reason: text }
          : {};
    try {
      await client.command(resolve, { effectId: effect.id, decision, ...extra } as never);
    } catch (error) {
      setMessage(refusal(error));
    } finally {
      setBusy(false);
    }
  };
  const label = describe?.(effect) ?? `${effect.type} for ${effect.resource}`;
  return (
    <li aria-label={label} className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{label}</span>
        <Badge variant="outline">{effect.target}</Badge>
        <Badge variant="secondary">
          {effect.attempts} {effect.attempts === 1 ? 'attempt' : 'attempts'}
        </Badge>
      </div>
      {effect.holdReason && <p className="text-sm">{effect.holdReason}</p>}
      <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
        {JSON.stringify(effect.payload, null, 2)}
      </pre>
      <p className="text-xs text-muted-foreground">
        Held since {new Date(effect.heldAt).toLocaleString()}
      </p>
      <Input
        aria-label="Reference or reason"
        placeholder="Reference found at the target, or why it was refused"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void decide('applied')}>
          Applied
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void decide('not-applied')}
        >
          Not applied, send again
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void decide('refused')}>
          Refused
        </Button>
      </div>
    </li>
  );
}

/**
 * Held deliveries, live: effects whose outcome nobody could establish, each with what was sent
 * and why it is held. The person checks the target and says whether it applied the delivery,
 * which settles it, sends it again, or settles it as refused. Pass `target` or `resource` to
 * show only one target's or one record's deliveries.
 */
export function ReconciliationReview({
  title = 'Held deliveries',
  list,
  resolve,
  target,
  resource,
  describe,
}: {
  title?: string;
  list: Query;
  resolve: Command;
  target?: string;
  resource?: string;
  /** A short label for a held effect; its type and record when omitted. */
  describe?: (effect: HeldEffect) => string;
}) {
  const input = { ...(target ? { target } : {}), ...(resource ? { resource } : {}) };
  const query = useQuery(live.liveQueryOptions(list, input as never));
  const items = (query.data as { items: HeldEffect[] } | undefined)?.items ?? [];
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-base font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No held deliveries.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((effect) => (
            <HeldItem
              key={effect.id}
              effect={effect}
              resolve={resolve}
              {...(describe ? { describe } : {})}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
