import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OutputOf } from '@tortoise/contracts';
import { workflowOperations } from '../contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { client, live } from '@/lib/session';

type Instance = OutputOf<typeof workflowOperations.list>['items'][number];

const time = (at: number | undefined) => (at === undefined ? '—' : new Date(at).toLocaleString());
const ended = ['succeeded', 'compensated', 'failed', 'cancelled'];
const tone = (status: Instance['status']) =>
  status === 'failed' || status === 'stalled'
    ? ('destructive' as const)
    : status === 'succeeded'
      ? ('default' as const)
      : ('outline' as const);

/** Run one command and show its refusal; the live query shows its effect. */
function useAction() {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The command failed');
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, act };
}

/**
 * Cancel while it runs; retry or mark handled once it stalled or failed. Only the starter sees
 * the history, so only they get retry and resolve, which the instance also refuses to others.
 */
function Controls({
  instance,
  busy,
  act,
}: {
  instance: Instance;
  busy: boolean;
  act: ReturnType<typeof useAction>['act'];
}) {
  const mine = instance.history !== undefined;
  const stopped =
    (instance.status === 'stalled' || instance.status === 'failed') && !instance.resolvedAt;
  return (
    <>
      {!ended.includes(instance.status) && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void act(() => client.command(workflowOperations.cancel, { id: instance.id }))
          }
        >
          Cancel
        </Button>
      )}
      {mine && stopped && (
        <>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void act(() => client.command(workflowOperations.retry, { id: instance.id }))
            }
          >
            Retry
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void act(() => client.command(workflowOperations.resolve, { id: instance.id }))
            }
          >
            Mark handled
          </Button>
        </>
      )}
    </>
  );
}

/** One instance (`workflow.get`): its error and step history for its starter. */
function Detail({ id }: { id: string }) {
  const instance = useQuery(live.liveQueryOptions(workflowOperations.get, { id })).data;
  if (!instance) return null;
  return (
    <div className="w-full space-y-1 text-muted-foreground">
      {instance.error && (
        <p>
          {instance.error.step} failed: {instance.error.code}: {instance.error.message}
        </p>
      )}
      {instance.history?.length ? (
        <ol className="space-y-1 pl-4">
          {instance.history.map((entry, index) => (
            <li key={index}>
              {entry.step}: {entry.outcome}
              {entry.code ? ` (${entry.code}: ${entry.message})` : ''} · {time(entry.at)}
            </li>
          ))}
        </ol>
      ) : (
        <p>Status only: another person started it.</p>
      )}
    </div>
  );
}

/**
 * Workflow instances (`workflow.list`): the signed-in person's own, and for the local user
 * everyone else's status. Selecting one shows its history.
 */
export function WorkflowsScreen() {
  const instances = useQuery(live.liveQueryOptions(workflowOperations.list, {}));
  const [selected, setSelected] = useState<string>();
  const { error, busy, act } = useAction();
  const items = instances.data?.items ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workflows</CardTitle>
        <CardDescription>
          Each instance runs its steps as the person who started it. Cancelling undoes the steps it
          completed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {items.length === 0 && <p className="text-muted-foreground">No workflow instances.</p>}
        <ul className="divide-y rounded-md border">
          {items.map((instance) => (
            <li
              key={instance.id}
              aria-label={`${instance.workflow} ${instance.id}`}
              className="flex flex-wrap items-center gap-3 p-3"
            >
              <span className="font-medium">{instance.workflow}</span>
              <Badge variant={tone(instance.status)}>{instance.status}</Badge>
              {instance.stalledReason && <Badge variant="outline">{instance.stalledReason}</Badge>}
              {instance.held && <Badge variant="outline">Held</Badge>}
              <span className="flex-1 text-muted-foreground">
                {instance.step ? `At ${instance.step} · ` : ''}
                started by {instance.starter} {time(instance.startedAt)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected(selected === instance.id ? undefined : instance.id)}
              >
                {selected === instance.id ? 'Hide' : 'Details'}
              </Button>
              <Controls instance={instance} busy={busy} act={act} />
              {selected === instance.id && <Detail id={instance.id} />}
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
