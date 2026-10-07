import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import type { OutputOf } from '@agent-native/contracts';
import { operations } from '../../../../examples/project-tasks/contracts';
import { Accounts, type AgentSelection } from '@/accounts';
import { useUiSession } from '@/ui-session';
import { ConflictBanner } from '@/components/conflict-banner';
import { RunPanel } from '@/components/run-panel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { client, live } from '@/lib/session';
import { cn } from '@/lib/utils';

type Task = OutputOf<typeof operations.taskGet>;

/** Projects and tasks. No domain state changes locally on command success; data arrives live. */
export function ProjectsScreen() {
  const projects = useQuery(live.liveQueryOptions(operations.projectList, {}));
  const [selected, setSelected] = useState('');
  const active =
    projects.data?.items.find((project) => project.id === selected) ?? projects.data?.items[0];
  const tasks = useQuery({
    ...live.liveQueryOptions(operations.taskList, active ? { projectId: active.id } : {}),
    enabled: active !== undefined,
  });
  const [projectName, setProjectName] = useState('');
  const [taskName, setTaskName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState(
    'Outline the work\nBuild the first version\nReview the result',
  );
  const [agent, setAgent] = useState<AgentSelection>({ harnessId: 'deterministic' });
  const ui = useUiSession(
    active ? { id: `project:${active.id}`, revision: active.revision } : undefined,
    async (resource) => {
      const [type, id] = resource.split(':');
      if (type === 'project' && id) setSelected(id);
      else if (type === 'task' && id) {
        const result = await client.query(operations.taskGet, { id });
        setSelected(result.data.projectId);
      } else throw new Error('Unknown resource');
    },
  );
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }
  const completed = tasks.data?.items.filter((task) => task.status === 'done').length ?? 0;
  const failure = error || projects.error?.message || tasks.error?.message;
  return (
    <div className="grid gap-8 xl:grid-cols-[14rem_1fr]">
      <section className="space-y-4">
        <div>
          <p className="text-xs font-medium tracking-widest text-muted-foreground">
            YOUR WORKSPACE
          </p>
          <h1 className="text-xl font-semibold">Projects</h1>
        </div>
        <nav aria-label="Projects" className="flex flex-col gap-1">
          {projects.data?.items.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => setSelected(project.id)}
              className={cn(
                'flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-muted',
                active?.id === project.id && 'bg-muted font-medium',
              )}
            >
              <span>{project.name}</span>
              {project.archived && <Badge variant="outline">Archived</Badge>}
            </button>
          ))}
        </nav>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void action(async () => {
              const receipt = await client.command(operations.projectCreate, { name: projectName });
              setSelected(receipt.result.id);
              setProjectName('');
            });
          }}
        >
          <Label htmlFor="project-name">New project</Label>
          <Input
            id="project-name"
            placeholder="Project name"
            required
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
          />
          <Button disabled={busy} variant="secondary" className="w-full">
            Create project
          </Button>
        </form>
      </section>
      <section className="min-w-0 space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium tracking-widest text-muted-foreground">
              PROJECT / OVERVIEW
            </p>
            <h2 className="text-2xl font-semibold">{active?.name ?? 'Your next project'}</h2>
            <p className="text-sm text-muted-foreground">
              {active
                ? `${completed} complete · ${tasks.data?.count ?? 0} tasks`
                : 'Create a project to begin. Your data stays on this computer.'}
            </p>
          </div>
          {active && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void action(() =>
                  client.command(
                    active.archived ? operations.projectRestore : operations.projectArchive,
                    { id: active.id },
                    { expectedRevisions: { [`project:${active.id}`]: active.revision } },
                  ),
                )
              }
            >
              {active.archived ? 'Restore project' : 'Archive project'}
            </Button>
          )}
        </header>
        {failure && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-6 2xl:grid-cols-[1fr_24rem]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Tasks <Badge variant="secondary">Live</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {active && !active.archived && (
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void action(async () => {
                      await client.command(operations.taskCreate, {
                        projectId: active.id,
                        title: taskName,
                      });
                      setTaskName('');
                    });
                  }}
                >
                  <Input
                    aria-label="New task title"
                    required
                    placeholder="What needs to happen?"
                    value={taskName}
                    onChange={(event) => setTaskName(event.target.value)}
                  />
                  <Button disabled={busy}>Add task</Button>
                </form>
              )}
              {active && tasks.isPending && <p role="status">Loading workspace…</p>}
              {(!active || (tasks.data && !tasks.data.items.length)) && (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <h4 className="font-medium">A clear place to start</h4>
                  <p className="text-sm text-muted-foreground">
                    Add a task yourself, or turn a brief into tasks with the agent.
                  </p>
                </div>
              )}
              <div className="divide-y">
                {tasks.data?.items.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    archived={active?.archived ?? false}
                    onError={setError}
                  />
                ))}
              </div>
              {active && <ProjectAccess id={active.id} onError={setError} />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                Agent workspace
                <Badge variant="outline">
                  {agent.harnessId === 'deterministic' ? 'Deterministic demo' : agent.harnessId}
                </Badge>
              </CardTitle>
              <CardDescription>
                {agent.harnessId === 'deterministic'
                  ? 'Turn a short plan into tasks. Each line becomes a task through the same commands used by this screen.'
                  : 'Ask the selected model to work on this project through the application tools.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Label htmlFor="brief">Project brief</Label>
              <Textarea
                id="brief"
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                rows={5}
              />
              <Button
                className="w-full"
                disabled={!active || active.archived || busy || !brief.trim()}
                onClick={() =>
                  void action(async () => {
                    if (!active) return;
                    const commands = brief
                      .split('\n')
                      .map((title) => title.trim())
                      .filter(Boolean)
                      .slice(0, 20)
                      .map((title) => ({
                        operation: operations.taskCreate.id,
                        input: { input: { projectId: active.id, title } },
                      }));
                    const capturedUi = await ui.prepare();
                    const prompt =
                      agent.harnessId === 'deterministic'
                        ? JSON.stringify({ commands, text: 'Creating the project tasks.' })
                        : `Work in project ${active.id}. Use application tools for changes; query current revisions before editing. ${brief}`;
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
                  })
                }
              >
                {agent.harnessId === 'deterministic' ? 'Create tasks from brief' : 'Run agent'} ↗
              </Button>
              <p className="text-xs text-muted-foreground">
                {agent.harnessId === 'deterministic'
                  ? 'Runs locally without an account. Provider adapters use the same tool contract.'
                  : agent.harnessId === 'codex'
                    ? 'Uses the selected ChatGPT plan. There is no automatic API-key fallback.'
                    : 'Uses your selected provider API key.'}
              </p>
              <Accounts selection={agent} onSelect={setAgent} onError={setError} />
              {ui.review && (
                <div className="space-y-2 rounded-lg border p-3">
                  <h4 className="font-medium">{ui.review.title}</h4>
                  <p className="text-sm text-muted-foreground">{ui.review.operations.join(', ')}</p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void ui.acknowledgeReview(true)}>
                      Acknowledge review
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void ui.acknowledgeReview(false)}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              )}
              <h4 className="pt-2 text-sm font-medium">Run activity</h4>
              <RunPanel onError={setError} />
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

/** A dirty draft retains its original base revision even when committed data updates. */
function TaskRow({
  task,
  archived,
  onError,
}: {
  task: Task;
  archived: boolean;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState<{ title: string; revision: number }>();
  const [pending, setPending] = useState(false);
  const conflict = draft !== undefined && draft.revision !== task.revision;
  const revisions = (revision: number) => ({ [`task:${task.id}`]: revision });
  async function save() {
    if (!draft) return;
    setPending(true);
    try {
      await client.command(
        operations.taskUpdate,
        { id: task.id, title: draft.title },
        { expectedRevisions: revisions(draft.revision) },
      );
      setDraft(undefined);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setPending(false);
    }
  }
  return (
    <article className="space-y-2 py-2" data-testid="task-row">
      <div className="flex items-center gap-2">
        <NativeSelect
          aria-label={`Status of ${task.title}`}
          value={task.status}
          disabled={archived || pending}
          className="w-32"
          onChange={(event) => {
            const status = event.target.value as Task['status'];
            void client
              .command(
                operations.taskSetStatus,
                { id: task.id, status },
                { expectedRevisions: revisions(task.revision) },
              )
              .catch((error) => onError(error.message));
          }}
        >
          <option value="todo">To do</option>
          <option value="doing">In progress</option>
          <option value="done">Done</option>
        </NativeSelect>
        {draft ? (
          <Input
            aria-label="Edit task title"
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        ) : (
          <button
            type="button"
            className={cn(
              'flex-1 truncate text-left text-sm hover:underline',
              task.status === 'done' && 'text-muted-foreground line-through',
            )}
            disabled={archived}
            onClick={() =>
              void client
                .query(operations.taskGet, { id: task.id })
                .then((snapshot) =>
                  setDraft({ title: snapshot.data.title, revision: snapshot.data.revision }),
                )
                .catch((error) => onError(error.message))
            }
          >
            {task.title}
          </button>
        )}
        <small className="tabular text-xs text-muted-foreground">v{task.revision}</small>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Delete ${task.title}`}
          disabled={archived || pending}
          onClick={() =>
            void client
              .command(
                operations.taskDelete,
                { id: task.id },
                { expectedRevisions: revisions(task.revision) },
              )
              .catch((error) => onError(error.message))
          }
        >
          <X />
        </Button>
      </div>
      {draft &&
        (conflict ? (
          <ConflictBanner
            onRebase={() => setDraft({ ...draft, revision: task.revision })}
            onDiscard={() => setDraft(undefined)}
          />
        ) : (
          <div className="flex gap-2">
            <Button size="sm" disabled={pending} onClick={() => void save()}>
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDraft(undefined)}>
              Discard draft
            </Button>
          </div>
        ))}
    </article>
  );
}

function ProjectAccess({ id, onError }: { id: string; onError: (message: string) => void }) {
  const project = useQuery(live.liveQueryOptions(operations.projectGet, { id }));
  const [principalId, setPrincipalId] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer' | 'owner' | 'remove'>('viewer');
  if (!project.data?.members) return null;
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Project access</summary>
      <p className="mt-2 text-muted-foreground">
        Membership controls apply to UI, tools and delegated runs.
      </p>
      <ul className="my-2 space-y-1">
        {Object.entries(project.data.members).map(([principal, membership]) => (
          <li key={principal}>
            {principal} <Badge variant="outline">{membership}</Badge>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (!project.data) return;
          void client
            .command(
              operations.projectSetMember,
              { id, principalId, role: role === 'remove' ? null : role },
              { expectedRevisions: { [`project:${id}`]: project.data.revision } },
            )
            .then(() => setPrincipalId(''))
            .catch((error) => onError(error.message));
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="member">Principal ID</Label>
          <Input
            id="member"
            value={principalId}
            onChange={(event) => setPrincipalId(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="member-role">Role</Label>
          <NativeSelect
            id="member-role"
            value={role}
            onChange={(event) => setRole(event.target.value as typeof role)}
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="owner">Owner</option>
            <option value="remove">Remove access</option>
          </NativeSelect>
        </div>
        <Button variant="secondary">Update access</Button>
      </form>
    </details>
  );
}
