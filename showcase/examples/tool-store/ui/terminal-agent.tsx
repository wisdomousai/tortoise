import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOperatorSession } from '@tortoise/workstation-sign-in/plugin-screens';
import { Accounts, type AgentSelection } from '@/components/accounts';
import { RunPanel, useRuns, type Run } from '@/components/run-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { hostJson } from '@/lib/host-client';
import type { UiReview } from '@/lib/ui-session';
import { operations } from '../contracts';
import type { Tool } from '../contracts/tool';
import {
  calibrationPullPrompt,
  calibrationPullScript,
  readToolsScript,
  type SelectedTool,
} from './terminal-runs';

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/** One captured tool by its asset tag, read as the attendant. */
function CapturedTool({ id }: { id: string }) {
  const { live } = useOperatorSession();
  const query = useQuery(live.liveQueryOptions(operations.toolGet, { id }));
  const tool = query.data as Tool | undefined;
  return (
    <li>
      <Badge variant="outline" className="font-mono">
        {tool?.assetTag ?? id}
      </Badge>
    </li>
  );
}

/** The tools the newest run captured from the UI session when it started. */
function CapturedTools({ run }: { run: Run }) {
  const context = run.context as { uiContext?: { selectedResources?: string[] } } | undefined;
  const captured = (context?.uiContext?.selectedResources ?? []).filter((resource) =>
    resource.startsWith('tool:'),
  );
  return (
    <section aria-label="Captured tools" className="space-y-2 text-sm">
      <p className="text-muted-foreground">
        Latest run <span className="font-mono">{run.id.slice(0, 8)}</span>{' '}
        {captured.length ? 'captured these tools:' : 'captured no tools.'}
      </p>
      {captured.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {captured.map((resource) => (
            <CapturedTool key={resource} id={resource.slice('tool:'.length)} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The agent panel under the terminal's tool list. A run starts from the work area's UI session,
 * so it captures the ticked tools, and it acts as the terminal's session, the workspace owner, not
 * as the signed-in attendant. The deterministic demo harness takes a script: Start run reads each
 * ticked tool with `tool.get`, and Pull for calibration opens the first ticked tool at the counter
 * and asks the attendant to review its bin change. A provider harness takes the brief instead.
 * Neither script calls a command; the attendant saves the change on the counter.
 */
export function TerminalAgent({
  selected,
  agent,
  onAgent,
  brief,
  onBrief,
  prepareSession,
}: {
  selected: readonly SelectedTool[];
  agent: AgentSelection;
  onAgent: (agent: AgentSelection) => void;
  brief: string;
  onBrief: (brief: string) => void;
  /** Bind the UI session to the current selection and return the version a run must capture. */
  prepareSession: () => Promise<{ sessionId: string; version: number }>;
}) {
  const runs = useRuns();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const briefId = useId();
  const demo = agent.harnessId === 'deterministic';
  const first = selected[0];
  const latest = runs.data?.at(-1);

  async function start(prompt: string) {
    setError('');
    setBusy(true);
    try {
      const { sessionId, version } = await prepareSession();
      await hostJson('runs', {
        harnessId: agent.harnessId,
        ...(agent.profileId ? { profileId: agent.profileId } : {}),
        ...(agent.model ? { model: agent.model } : {}),
        prompt,
        uiSessionId: sessionId,
        uiContextVersion: version,
      });
    } catch (failure) {
      setError(messageOf(failure, 'The run did not start'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Agent" className="space-y-3">
      <h3 className="text-base font-medium">Agent</h3>
      <p className="text-sm text-muted-foreground">
        A run works on the ticked tools as the terminal, not as you. It can open a tool on the
        counter and ask you to review a change; you save the change.
      </p>
      <Accounts selection={agent} onSelect={onAgent} onError={setError} />
      <div className="space-y-1">
        <Label htmlFor={briefId}>Brief</Label>
        <Textarea
          id={briefId}
          value={brief}
          onChange={(event) => onBrief(event.target.value)}
          placeholder="What the agent does with the ticked tools"
        />
        {demo && (
          <p className="text-xs text-muted-foreground">
            The demo harness runs a script and ignores the brief.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={busy || !first || (!demo && !brief.trim())}
          onClick={() => void start(demo ? readToolsScript(selected) : brief.trim())}
        >
          Start run
        </Button>
        <Button
          variant="outline"
          disabled={busy || !first}
          onClick={() =>
            first &&
            void start(demo ? calibrationPullScript(first) : calibrationPullPrompt(brief, first))
          }
        >
          Pull for calibration
        </Button>
        {!first && <span className="text-sm text-muted-foreground">Tick a tool first.</span>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {latest && <CapturedTools run={latest} />}
      <RunPanel onError={setError} />
    </section>
  );
}

/**
 * A review an agent run asked for, with a line that names the run. `hint` says what the attendant
 * does; acknowledging closes the review.
 */
export function RunReview({
  review,
  hint,
  onAcknowledge,
}: {
  review: UiReview;
  hint: string;
  onAcknowledge: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  return (
    <section aria-label="Agent review" className="space-y-2 rounded-lg border border-warning p-3">
      <p className="font-medium">{review.title}</p>
      <p className="text-sm text-muted-foreground">
        {review.runId ? (
          <>
            Agent run <span className="font-mono">{review.runId.slice(0, 8)}</span> asks for this
            review.
          </>
        ) : (
          'An agent asks for this review.'
        )}{' '}
        {hint}
      </p>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setError('');
            onAcknowledge().catch((failure) =>
              setError(messageOf(failure, 'Acknowledging failed')),
            );
          }}
        >
          Acknowledge
        </Button>
        {error && (
          <span role="alert" className="text-sm text-destructive">
            {error}
          </span>
        )}
      </div>
    </section>
  );
}
