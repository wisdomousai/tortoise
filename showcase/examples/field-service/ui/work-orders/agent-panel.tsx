import { useState } from 'react';
import { operations, workOrderPlannerModule } from '../../contracts';
import { Accounts, type AgentSelection } from '@/components/accounts';
import { RunPanel } from '@/components/run-panel';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { useUiSession } from '@/lib/ui-session';
import type { WorkOrder } from './shared';

type UiSession = ReturnType<typeof useUiSession>;

/** The planner definition a provider run executes under. */
const planner = workOrderPlannerModule.agents![0]!.id;

/**
 * Start a run over this work order. The offline demo gets the instructions as explicit task commands; a
 * provider run executes under the work order planner, with its instructions and narrowed grant,
 * and requests approval for the tasks. Either way the run carries the captured UI session, so it
 * sees this work order and acts only through the catalog.
 */
async function startRun(
  workOrder: WorkOrder,
  instructions: string,
  agent: AgentSelection,
  ui: UiSession,
) {
  const demo = agent.harnessId === 'deterministic';
  const commands = instructions
    .split('\n')
    .map((title) => title.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((title) => ({
      operation: operations.taskCreate.id,
      input: { input: { workOrderId: workOrder.id, title } },
    }));
  const capturedUi = await ui.prepare();
  const prompt = demo
    ? JSON.stringify({ commands, text: 'Creating the work order tasks.' })
    : `Work in work order ${workOrder.id}. Use application tools for changes; query current revisions before editing. ${instructions}`;
  const response = await fetch('/api/v1/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...agent,
      ...(demo ? {} : { agentId: planner }),
      uiSessionId: capturedUi.sessionId,
      uiContextVersion: capturedUi.version,
      prompt,
    }),
  });
  if (!response.ok) throw new Error('Unable to start run');
}

/** A review the agent asked for in the UI session, acknowledged or dismissed by the person. */
function ReviewRequest({
  review,
  ui,
}: {
  review: NonNullable<UiSession['review']>;
  ui: UiSession;
}) {
  return (
    <div className="space-y-2 rounded-xl border-2 border-warning/60 p-3">
      <h3 className="font-medium">{review.title}</h3>
      <p className="text-sm text-muted-foreground">{review.operations.join(', ')}</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void ui.acknowledgeReview(true)}>
          Acknowledge review
        </Button>
        <Button size="sm" variant="outline" onClick={() => void ui.acknowledgeReview(false)}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

/** Which agent runs, and which account pays for it. */
function AgentChoice({
  agent,
  onSelect,
  onError,
}: {
  agent: AgentSelection;
  onSelect: (agent: AgentSelection) => void;
  onError: (message: string) => void;
}) {
  return (
    <details className="rounded-xl border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Agent to use</summary>
      <div className="mt-3 space-y-2">
        <p className="text-xs text-muted-foreground">
          {agent.harnessId === 'deterministic'
            ? 'The offline demo runs locally without an account. Provider agents use the same tool contract.'
            : agent.harnessId === 'codex'
              ? 'Uses the selected ChatGPT plan. There is no automatic API-key fallback.'
              : 'Uses your selected provider API key.'}
        </p>
        <Accounts selection={agent} onSelect={onSelect} onError={onError} />
      </div>
    </details>
  );
}

/**
 * The agent beside the work. A run sees this work order through the UI session and changes it only
 * through the same commands this screen uses; its activity and questions appear below.
 */
export function AgentPanel({
  workOrder,
  ui,
  busy,
  action,
  onError,
}: {
  workOrder: WorkOrder;
  ui: UiSession;
  busy: boolean;
  action: (work: () => Promise<unknown>) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [instructions, setInstructions] = useState(
    'Outline the work\nBuild the first version\nReview the result',
  );
  const [agent, setAgent] = useState<AgentSelection>({ harnessId: 'deterministic' });
  const demo = agent.harnessId === 'deterministic';
  return (
    <aside
      aria-label="Agent"
      className="space-y-4 rounded-2xl border bg-card p-5 xl:sticky xl:top-8"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Agent</h2>
        <span className="text-xs text-muted-foreground">
          {demo ? 'Offline demo, no account' : agent.harnessId}
        </span>
      </div>
      <div className="space-y-2">
        <Label htmlFor="instructions">Work order instructions</Label>
        <p className="text-sm text-muted-foreground">
          {demo
            ? 'Each line becomes a task, through the same commands you use.'
            : 'The planner sees this work order and asks for approval of each task it proposes.'}
        </p>
        <Textarea
          id="instructions"
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          rows={5}
        />
        <Button
          className="w-full"
          disabled={workOrder.closed || busy || !instructions.trim()}
          onClick={() => void action(() => startRun(workOrder, instructions, agent, ui))}
        >
          {demo ? 'Create tasks from instructions' : 'Ask the agent'}
        </Button>
      </div>
      {ui.review && <ReviewRequest review={ui.review} ui={ui} />}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Activity</h3>
        <RunPanel onError={onError} />
      </div>
      <AgentChoice agent={agent} onSelect={setAgent} onError={onError} />
    </aside>
  );
}
