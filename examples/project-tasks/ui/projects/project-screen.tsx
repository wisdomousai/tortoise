import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { operations } from '../../contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { client, live } from '@/lib/session';
import { useUiSession } from '@/lib/ui-session';
import { AgentPanel } from './agent-panel';
import { PreparedTask } from './prepared-task';
import { ProjectAccess } from './project-access';
import { message, projectPath, taskProjectPath, useProjectId, type Project } from './shared';
import { TaskGroup } from './task-group';

/** One action at a time for the screen: `busy` while it runs, its failure as `error`. */
function useAction() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  return { error, setError, busy, action };
}

/**
 * Share the open project with agent runs, and follow a run that navigates: to a project, or to
 * the project of a task it names.
 */
function useProjectSession(project: Project | undefined) {
  const navigate = useNavigate();
  return useUiSession(
    project ? { id: `project:${project.id}`, revision: project.revision } : undefined,
    async (resource) => {
      const [type, id] = resource.split(':');
      const to =
        type === 'project' && id
          ? projectPath(id)
          : type === 'task' && id
            ? await taskProjectPath(id)
            : undefined;
      if (!to) throw new Error('Unknown resource');
      await navigate({ to });
    },
  );
}

/** Name, progress and sharing, with the share toggle and archive or restore. */
function ProjectHeader({
  project,
  done,
  count,
  sharing,
  onSharing,
  busy,
  action,
}: {
  project: Project;
  done: number;
  count: number;
  sharing: boolean;
  onSharing: () => void;
  busy: boolean;
  action: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const members = Object.keys(project.members ?? {}).length;
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 px-6 pt-6 pb-4">
      <div className="min-w-0">
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">
          {project.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {done} of {count} done
          {members > 1
            ? ` · shared with ${members - 1} ${members === 2 ? 'person' : 'people'}`
            : ''}
          {project.archived ? ' · archived' : ''}
        </p>
      </div>
      <div className="flex gap-2">
        {project.members && (
          <Button variant="outline" aria-expanded={sharing} onClick={onSharing}>
            Share
          </Button>
        )}
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void action(() =>
              client.command(
                project.archived ? operations.projectRestore : operations.projectArchive,
                { id: project.id },
                { expectedRevisions: { [`project:${project.id}`]: project.revision } },
              ),
            )
          }
        >
          {project.archived ? 'Restore project' : 'Archive project'}
        </Button>
      </div>
    </header>
  );
}

/** Add a task by title. The screen keeps the title, so archiving and restoring keep it too. */
function NewTaskForm({
  title,
  onTitle,
  busy,
  onSubmit,
}: {
  title: string;
  onTitle: (title: string) => void;
  busy: boolean;
  onSubmit: () => void;
}) {
  return (
    <form
      className="flex gap-2 px-6 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Input
        aria-label="New task title"
        required
        placeholder="Add a task and press Enter"
        className="h-11"
        value={title}
        onChange={(event) => onTitle(event.target.value)}
      />
      <Button type="submit" variant="outline" className="h-11" disabled={busy}>
        Add task
      </Button>
    </form>
  );
}

/** One project: its tasks grouped by status, its access and the agent working on it. */
export function ProjectScreen() {
  const projectId = useProjectId()!;
  const project = useQuery(live.liveQueryOptions(operations.projectGet, { id: projectId }));
  // Totals come from authorized counts, not from the rows on a visible page.
  const total = useQuery(live.liveQueryOptions(operations.taskList, { projectId, limit: 1 }));
  const done = useQuery(
    live.liveQueryOptions(operations.taskList, { projectId, status: 'done', limit: 1 }),
  );
  const { error, setError, busy, action } = useAction();
  const [taskName, setTaskName] = useState('');
  const [sharing, setSharing] = useState(false);
  const ui = useProjectSession(project.data);
  if (project.error)
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{project.error.message}</AlertDescription>
      </Alert>
    );
  if (!project.data) return <p role="status">Loading project…</p>;
  const active = project.data;
  const count = total.data?.count ?? 0;
  const addTask = () =>
    void action(async () => {
      await client.command(operations.taskCreate, { projectId: active.id, title: taskName });
      setTaskName('');
    });
  return (
    <div className="mx-auto grid max-w-7xl items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section aria-label="Tasks" className="overflow-hidden rounded-2xl border bg-card">
        <ProjectHeader
          project={active}
          done={done.data?.count ?? 0}
          count={count}
          sharing={sharing}
          onSharing={() => setSharing((value) => !value)}
          busy={busy}
          action={action}
        />
        {sharing && <ProjectAccess project={active} onError={setError} />}
        {error && (
          <Alert variant="destructive" role="alert" className="mx-6 mb-4 w-auto">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <PreparedTask project={active} busy={busy} action={action} />
        {!active.archived && (
          <NewTaskForm title={taskName} onTitle={setTaskName} busy={busy} onSubmit={addTask} />
        )}
        {total.data && count === 0 && (
          <div className="mx-6 mb-6 rounded-xl border border-dashed p-8 text-center">
            <h2 className="font-medium">A clear place to start</h2>
            <p className="text-sm text-muted-foreground">
              Add a task yourself, or turn a brief into tasks with the agent.
            </p>
          </div>
        )}
        <TaskGroup project={active} status="doing" title="In progress" onError={setError} />
        <TaskGroup project={active} status="todo" title="To do" onError={setError} />
        <TaskGroup project={active} status="done" title="Done" onError={setError} collapsed />
      </section>
      <AgentPanel project={active} ui={ui} busy={busy} action={action} onError={setError} />
    </div>
  );
}
