import { useState } from 'react';
import { operations } from '../../contracts';
import { Accounts, type AgentSelection } from '@/components/accounts';
import { RunPanel } from '@/components/run-panel';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { useUiSession } from '@/lib/ui-session';
import type { Project } from './shared';

type UiSession = ReturnType<typeof useUiSession>;

/**
 * Start a run over this project. The offline demo gets the brief as explicit task commands; a
 * provider agent gets a prompt. Either way the run carries the captured UI session, so it sees
 * this project and acts only through the catalog.
 */
async function startRun(project: Project, brief: string, agent: AgentSelection, ui: UiSession) {
  const demo = agent.harnessId === 'deterministic';
  const commands = brief
    .split('\n')
    .map((title) => title.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((title) => ({
      operation: operations.taskCreate.id,
      input: { input: { projectId: project.id, title } },
    }));
  const capturedUi = await ui.prepare();
  const prompt = demo
    ? JSON.stringify({ commands, text: 'Creating the project tasks.' })
    : `Work in project ${project.id}. Use application tools for changes; query current revisions before editing. ${brief}`;
  const response = await fetch('/api/v1/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...agent,
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
 * The agent beside the work. A run sees this project through the UI session and changes it only
 * through the same commands this screen uses; its activity and questions appear below.
 */
export function AgentPanel({
  project,
  ui,
  busy,
  action,
  onError,
}: {
  project: Project;
  ui: UiSession;
  busy: boolean;
  action: (work: () => Promise<unknown>) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [brief, setBrief] = useState(
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
        <Label htmlFor="brief">Project brief</Label>
        <p className="text-sm text-muted-foreground">
          {demo
            ? 'Each line becomes a task, through the same commands you use.'
            : 'The agent sees this project and uses the same actions you do.'}
        </p>
        <Textarea
          id="brief"
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          rows={5}
        />
        <Button
          className="w-full"
          disabled={project.archived || busy || !brief.trim()}
          onClick={() => void action(() => startRun(project, brief, agent, ui))}
        >
          {demo ? 'Create tasks from brief' : 'Ask the agent'}
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
