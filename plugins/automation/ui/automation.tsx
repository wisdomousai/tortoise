import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OutputOf } from '@agent-native/contracts';
import { automationOperations } from '../contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { client, live } from '@/lib/session';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const time = (at: number | undefined) => (at === undefined ? '—' : new Date(at).toLocaleString());

/** Run one command and show its refusal; the live queries show its effect. */
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

type TriggerSummary = OutputOf<typeof automationOperations.triggerList>['items'][number];
type Act = ReturnType<typeof useAction>['act'];

/** Enable a trigger with a week's standing grant, or renew or revoke the active one. */
function GrantControls({
  trigger,
  busy,
  act,
}: {
  trigger: TriggerSummary;
  busy: boolean;
  act: Act;
}) {
  return trigger.grant ? (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() =>
          void act(() =>
            client.command(automationOperations.grantRenew, {
              id: trigger.grant!.id,
              expiresInMs: WEEK,
            }),
          )
        }
      >
        Renew
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() =>
          void act(() =>
            client.command(automationOperations.grantRevoke, { id: trigger.grant!.id }),
          )
        }
      >
        Revoke
      </Button>
    </>
  ) : (
    <Button
      size="sm"
      disabled={busy}
      onClick={() =>
        void act(() =>
          client.command(automationOperations.grantIssue, {
            trigger: trigger.id,
            expiresInMs: WEEK,
          }),
        )
      }
    >
      Enable for a week
    </Button>
  );
}

/**
 * Triggers (`automation.trigger.list`) with their standing grants. Enabling issues a grant as
 * the signed-in person for a week; every run then acts as them. Renew and revoke apply to the
 * grant they issued, and the authority refuses anyone else's.
 */
function Triggers() {
  const triggers = useQuery(live.liveQueryOptions(automationOperations.triggerList, {}));
  const { error, busy, act } = useAction();
  const items = triggers.data?.items ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Triggers</CardTitle>
        <CardDescription>
          A trigger runs only while a person&apos;s standing grant is active, and acts as that
          person.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {items.length === 0 && <p className="text-muted-foreground">No triggers declared.</p>}
        <ul className="divide-y rounded-md border">
          {items.map((trigger) => (
            <li
              key={trigger.id}
              aria-label={trigger.title}
              className="flex flex-wrap items-center gap-3 p-3"
            >
              <span className="font-medium">{trigger.title}</span>
              <Badge variant="outline">
                {trigger.on === 'event' ? 'On change' : 'On schedule'}
              </Badge>
              <Badge variant="outline">{trigger.runs === 'agent' ? 'Agent' : 'Job'}</Badge>
              {trigger.openFailures > 0 && (
                <Badge variant="destructive">{trigger.openFailures} failed</Badge>
              )}
              <span className="flex-1 text-muted-foreground">
                {trigger.grant
                  ? `Runs as ${trigger.grant.issuedBy} until ${time(trigger.grant.expiresAt)}`
                  : 'Off'}
                {trigger.lastRunAt
                  ? ` · last run ${time(trigger.lastRunAt)} ${trigger.lastOutcome}`
                  : ''}
              </span>
              <GrantControls trigger={trigger} busy={busy} act={act} />
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

/** Failed runs under the person's grants (`automation.failure.list`); a failure is never retried. */
function Failures() {
  const failures = useQuery(
    live.liveQueryOptions(automationOperations.failureList, { open: true }),
  );
  const { error, busy, act } = useAction();
  const items = failures.data?.items ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Failed runs</CardTitle>
        <CardDescription>Act on the cause yourself, then mark the failure handled.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {items.length === 0 ? (
          <p className="text-muted-foreground">No open failures.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {items.map((failure) => (
              <li key={failure.id} className="flex flex-wrap items-center gap-3 p-3">
                <Badge variant="destructive">{failure.code}</Badge>
                <span className="flex-1">
                  {failure.trigger}: {failure.message}
                  <span className="text-muted-foreground"> · {time(failure.at)}</span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      client.command(automationOperations.failureResolve, { id: failure.id }),
                    )
                  }
                >
                  Mark handled
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function AutomationScreen() {
  return (
    <div className="space-y-6">
      <Triggers />
      <Failures />
    </div>
  );
}
