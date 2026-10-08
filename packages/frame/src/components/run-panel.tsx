import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hostJson } from '@/lib/host-client';

export type Run = {
  id: string;
  state: string;
  events: {
    type: string;
    text?: string;
    message?: string;
    operation?: string;
    requestId?: string;
    choices?: string[];
  }[];
  failure?: { message: string };
};
const finished = ['succeeded', 'failed', 'cancelled', 'interrupted'];

/** Recent agent runs. Run state is host metadata, polled; business data arrives live. */
export function useRuns() {
  return useQuery({
    queryKey: ['runs'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/v1/runs', { signal });
      return response.ok ? ((await response.json()) as Run[]) : [];
    },
    refetchInterval: 750,
  });
}

/** Run activity with inline answers to agent questions and approvals. */
export function RunPanel({ onError }: { onError: (message: string) => void }) {
  const runs = useRuns();
  if (!runs.data?.length)
    return (
      <p className="text-sm text-muted-foreground">Activity appears here when a run starts.</p>
    );
  return (
    <div className="space-y-2">
      {runs.data
        .slice(-5)
        .reverse()
        .map((run) => (
          <RunCard key={run.id} run={run} onError={onError} />
        ))}
    </div>
  );
}

type RunEvent = Run['events'][number];

/** The newest narration or operation, or the failure message once the run failed. */
const latestOf = (run: Run) =>
  run.failure?.message ??
  run.events
    .filter((event) => event.text || event.operation)
    .slice(-1)
    .map((event) => event.text ?? event.operation)
    .join('');

/** Answer state for a run's open request; kept by the card so a typed answer survives polling. */
function useRunResponse(
  runId: string,
  request: RunEvent | undefined,
  onError: (message: string) => void,
) {
  const [answer, setAnswer] = useState('');
  const [pending, setPending] = useState(false);
  async function respond(value: string | boolean) {
    if (!request?.requestId) return;
    setPending(true);
    try {
      await hostJson(`runs/${runId}/respond`, {
        requestId: request.requestId,
        type: request.type,
        ...(typeof value === 'boolean' ? { approved: value } : { answer: value }),
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Response failed');
    } finally {
      setPending(false);
    }
  }
  return { answer, setAnswer, pending, respond };
}

/** An open question or approval: approve/decline, one of the offered choices, or free text. */
function RunRequest({
  request,
  response: { answer, setAnswer, pending, respond },
}: {
  request: RunEvent;
  response: ReturnType<typeof useRunResponse>;
}) {
  return (
    <div className="space-y-2 rounded-md bg-muted p-2">
      <p>{request.message}</p>
      {request.type === 'approval' ? (
        <div className="flex gap-2">
          <Button size="sm" disabled={pending} onClick={() => void respond(true)}>
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => void respond(false)}
          >
            Decline
          </Button>
        </div>
      ) : request.choices?.length ? (
        <div className="flex flex-wrap gap-2">
          {request.choices.map((choice) => (
            <Button
              key={choice}
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => void respond(choice)}
            >
              {choice}
            </Button>
          ))}
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void respond(answer);
          }}
        >
          <Input
            aria-label="Answer agent question"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            required
          />
          <Button size="sm" disabled={pending}>
            Send answer
          </Button>
        </form>
      )}
    </div>
  );
}

function RunCard({ run, onError }: { run: Run; onError: (message: string) => void }) {
  const request = run.state.startsWith('awaiting-')
    ? run.events.filter((event) => event.type === 'question' || event.type === 'approval').at(-1)
    : undefined;
  const response = useRunResponse(run.id, request, onError);
  const latest = latestOf(run);
  return (
    <article className="space-y-2 rounded-lg border bg-card p-3 text-sm">
      <div className="flex items-center gap-2">
        <Badge variant={run.state === 'failed' ? 'destructive' : 'secondary'}>{run.state}</Badge>
        <small className="font-mono text-muted-foreground">{run.id.slice(0, 8)}</small>
      </div>
      {latest && <p className="text-muted-foreground">{latest}</p>}
      {request && <RunRequest request={request} response={response} />}
      {!finished.includes(run.state) && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void hostJson(`runs/${run.id}/cancel`, {}).catch((error) => onError(error.message))
          }
        >
          Cancel run
        </Button>
      )}
    </article>
  );
}
