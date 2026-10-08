import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Check, Plus, X } from 'lucide-react';
import type { OutputOf } from '@agent-native/contracts';
import { operations } from '../contracts';
import { Accounts, type AgentSelection } from '@/components/accounts';
import { SidebarLink, SidebarSection } from '@/components/app-shell';
import { useUiSession } from '@/lib/ui-session';
import { ConflictBanner } from '@/components/conflict-banner';
import { RunPanel } from '@/components/run-panel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { client, live } from '@/lib/session';
import { cn } from '@/lib/utils';

type Task = OutputOf<typeof operations.taskGet>;
type Status = Task['status'];
type Project = OutputOf<typeof operations.projectGet>;
const PAGE = 50;
const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Action failed');

/** The project a screen shows, from the route; undefined on the projects index. */
const useProjectId = () => (useParams({ strict: false }) as { projectId?: string }).projectId;

/**
 * Sidebar section: the person's projects with the open one highlighted, and creating one. The
 * list is server-paginated; archived projects are counted and listed separately.
 */
export function ProjectList() {
  const navigate = useNavigate();
  const current = useProjectId();
  const active = useQuery(
    live.liveQueryOptions(operations.projectList, { archived: false, limit: PAGE }),
  );
  const archived = useQuery(
    live.liveQueryOptions(operations.projectList, { archived: true, limit: PAGE }),
  );
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const create = async () => {
    setError('');
    try {
      const receipt = await client.command(operations.projectCreate, { name });
      setName('');
      setCreating(false);
      void navigate({ to: '/projects/$projectId', params: { projectId: receipt.result.id } });
    } catch (cause) {
      setError(message(cause));
    }
  };
  const link = (project: Project) => (
    <SidebarLink
      key={project.id}
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      active={project.id === current}
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
    </SidebarLink>
  );
  return (
    <SidebarSection
      title="Projects"
      action={
        <button
          type="button"
          aria-label="Add a project"
          aria-expanded={creating}
          onClick={() => setCreating((value) => !value)}
          className="rounded p-0.5 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      }
    >
      {active.data?.items.map(link)}
      {active.data && active.data.count > active.data.items.length && (
        <p className="px-3 py-1 text-xs text-sidebar-muted">
          {active.data.count - active.data.items.length} more; find them with ⌘K
        </p>
      )}
      {creating && (
        <form
          className="mt-1 space-y-1.5 px-1"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <Input
            aria-label="Project name"
            placeholder="Project name"
            required
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-9 border-white/15 bg-sidebar-accent text-sidebar-foreground placeholder:text-sidebar-muted"
          />
          <Button type="submit" size="sm" className="w-full">
            Create project
          </Button>
          {error && <p className="text-xs text-red-300">{error}</p>}
        </form>
      )}
      {archived.data && archived.data.count > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer px-3 py-1.5 text-sm text-sidebar-muted hover:text-sidebar-foreground">
            Archived ({archived.data.count})
          </summary>
          {archived.data.items.map(link)}
        </details>
      )}
    </SidebarSection>
  );
}

/** `/projects`: opens the first project, or offers to create one. */
export function ProjectsScreen() {
  const navigate = useNavigate();
  const projects = useQuery(
    live.liveQueryOptions(operations.projectList, { archived: false, limit: 1 }),
  );
  const first = projects.data?.items[0];
  useEffect(() => {
    if (first)
      void navigate({ to: '/projects/$projectId', params: { projectId: first.id }, replace: true });
  }, [first, navigate]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  if (!projects.data || first) return <p role="status">Loading projects…</p>;
  return (
    <div className="mx-auto max-w-xl space-y-4 rounded-2xl border border-dashed bg-card p-10 text-center">
      <h1 className="text-2xl font-semibold">Your first project</h1>
      <p className="text-sm text-muted-foreground">
        Name it, then add tasks yourself or let the agent turn a brief into tasks. Your data stays
        on this computer.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void client
            .command(operations.projectCreate, { name })
            .then((receipt) =>
              navigate({ to: '/projects/$projectId', params: { projectId: receipt.result.id } }),
            )
            .catch((cause) => setError(message(cause)));
        }}
      >
        <Label htmlFor="first-project" className="sr-only">
          New project
        </Label>
        <Input
          id="first-project"
          placeholder="Project name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit">Create project</Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** One project: its tasks grouped by status, its access and the agent working on it. */
export function ProjectScreen() {
  const navigate = useNavigate();
  const projectId = useProjectId()!;
  const project = useQuery(live.liveQueryOptions(operations.projectGet, { id: projectId }));
  // Totals come from authorized counts, not from the rows on a visible page.
  const total = useQuery(live.liveQueryOptions(operations.taskList, { projectId, limit: 1 }));
  const done = useQuery(
    live.liveQueryOptions(operations.taskList, { projectId, status: 'done', limit: 1 }),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [taskName, setTaskName] = useState('');
  const [sharing, setSharing] = useState(false);
  const ui = useUiSession(
    project.data
      ? { id: `project:${project.data.id}`, revision: project.data.revision }
      : undefined,
    async (resource) => {
      const [type, id] = resource.split(':');
      const target =
        type === 'project' && id
          ? id
          : type === 'task' && id
            ? (await client.query(operations.taskGet, { id })).data.projectId
            : undefined;
      if (!target) throw new Error('Unknown resource');
      await navigate({ to: '/projects/$projectId', params: { projectId: target } });
    },
  );
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
  if (project.error)
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{project.error.message}</AlertDescription>
      </Alert>
    );
  if (!project.data) return <p role="status">Loading project…</p>;
  const active = project.data;
  const members = Object.keys(active.members ?? {}).length;
  const count = total.data?.count ?? 0;
  return (
    <div className="mx-auto grid max-w-7xl items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section aria-label="Tasks" className="overflow-hidden rounded-2xl border bg-card">
        <header className="flex flex-wrap items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div className="min-w-0">
            <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">
              {active.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {done.data?.count ?? 0} of {count} done
              {members > 1
                ? ` · shared with ${members - 1} ${members === 2 ? 'person' : 'people'}`
                : ''}
              {active.archived ? ' · archived' : ''}
            </p>
          </div>
          <div className="flex gap-2">
            {active.members && (
              <Button
                variant="outline"
                aria-expanded={sharing}
                onClick={() => setSharing((value) => !value)}
              >
                Share
              </Button>
            )}
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
          </div>
        </header>
        {sharing && <ProjectAccess project={active} onError={setError} />}
        {error && (
          <Alert variant="destructive" role="alert" className="mx-6 mb-4 w-auto">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!active.archived && (
          <form
            className="flex gap-2 px-6 pb-4"
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
              placeholder="Add a task and press Enter"
              className="h-11"
              value={taskName}
              onChange={(event) => setTaskName(event.target.value)}
            />
            <Button type="submit" variant="outline" className="h-11" disabled={busy}>
              Add task
            </Button>
          </form>
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

/** One status group with its own server-side page; hidden while empty. */
function TaskGroup({
  project,
  status,
  title,
  collapsed = false,
  onError,
}: {
  project: Project;
  status: Status;
  title: string;
  collapsed?: boolean;
  onError: (message: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const tasks = useQuery(
    live.liveQueryOptions(operations.taskList, {
      projectId: project.id,
      status,
      offset,
      limit: PAGE,
    }),
  );
  const count = tasks.data?.count ?? 0;
  if (!count) return null;
  const body = (
    <>
      <ul className="divide-y">
        {tasks.data?.items.map((task) => (
          <TaskRow key={task.id} task={task} archived={project.archived} onError={onError} />
        ))}
      </ul>
      <Pager label={title} offset={offset} count={count} onChange={setOffset} />
    </>
  );
  const heading = (
    <>
      {title} · <span className="tabular-nums">{count}</span>
    </>
  );
  if (collapsed)
    return (
      <details className="border-t">
        <summary className="cursor-pointer px-6 py-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase hover:text-foreground">
          {heading}
        </summary>
        {body}
      </details>
    );
  return (
    <div className="border-t">
      <h2 className="px-6 pt-3 pb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {heading}
      </h2>
      {body}
    </div>
  );
}

/** Previous/next paging over an authorized list; hidden when everything fits on one page. */
function Pager(props: {
  label: string;
  offset: number;
  count: number | undefined;
  onChange(offset: number): void;
}) {
  const { label, offset, count, onChange } = props;
  if (count === undefined || (offset === 0 && count <= PAGE)) return null;
  return (
    <nav
      aria-label={`${label} pages`}
      className="flex items-center justify-between gap-2 px-6 py-2 text-sm"
    >
      <span className="text-muted-foreground">
        {Math.min(offset + 1, count)}–{Math.min(offset + PAGE, count)} of {count}
      </span>
      <span className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - PAGE))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={offset + PAGE >= count}
          onClick={() => onChange(offset + PAGE)}
        >
          Next
        </Button>
      </span>
    </nav>
  );
}

/** The status button moves a task one step: to do → in progress → done → to do. */
const nextStatus: Record<Status, { to: Status; verb: string }> = {
  todo: { to: 'doing', verb: 'Start' },
  doing: { to: 'done', verb: 'Finish' },
  done: { to: 'todo', verb: 'Reopen' },
};

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
  const next = nextStatus[task.status];
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
      onError(message(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <li className="group space-y-2 px-6 py-2.5" data-testid="task-row">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`${next.verb} ${task.title}`}
          disabled={archived || pending}
          onClick={() =>
            void client
              .command(
                operations.taskSetStatus,
                { id: task.id, status: next.to },
                { expectedRevisions: revisions(task.revision) },
              )
              .catch((error) => onError(message(error)))
          }
          className={cn(
            'flex size-5.5 shrink-0 items-center justify-center rounded-full border-2 disabled:opacity-50',
            task.status === 'todo' && 'border-muted-foreground/50 hover:border-primary',
            task.status === 'doing' &&
              'border-primary bg-[linear-gradient(90deg,var(--primary)_50%,transparent_50%)]',
            task.status === 'done' && 'border-success bg-success text-white',
          )}
        >
          {task.status === 'done' && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
        </button>
        {draft ? (
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!conflict) void save();
            }}
          >
            <Input
              aria-label="Edit task title"
              autoFocus
              className="h-9"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              onKeyDown={(event) => event.key === 'Escape' && setDraft(undefined)}
            />
            {!conflict && (
              <>
                <Button size="sm" type="submit" disabled={pending}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft(undefined)}>
                  Cancel
                </Button>
              </>
            )}
          </form>
        ) : (
          <button
            type="button"
            className={cn(
              'min-w-0 flex-1 truncate text-left text-[0.95rem] hover:underline',
              task.status === 'done' && 'text-muted-foreground line-through',
            )}
            disabled={archived}
            onClick={() =>
              void client
                .query(operations.taskGet, { id: task.id })
                .then((snapshot) =>
                  setDraft({ title: snapshot.data.title, revision: snapshot.data.revision }),
                )
                .catch((error) => onError(message(error)))
            }
          >
            {task.title}
          </button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Delete ${task.title}`}
          className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          disabled={archived || pending}
          onClick={() =>
            void client
              .command(
                operations.taskDelete,
                { id: task.id },
                { expectedRevisions: revisions(task.revision) },
              )
              .catch((error) => onError(message(error)))
          }
        >
          <X />
        </Button>
      </div>
      {draft && conflict && (
        <ConflictBanner
          onRebase={() => setDraft({ ...draft, revision: task.revision })}
          onDiscard={() => setDraft(undefined)}
        />
      )}
    </li>
  );
}

/** Who may see and change the project. Membership applies to the UI, tools and delegated runs. */
function ProjectAccess({
  project,
  onError,
}: {
  project: Project;
  onError: (message: string) => void;
}) {
  const [principalId, setPrincipalId] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer' | 'owner' | 'remove'>('viewer');
  if (!project.members) return null;
  return (
    <section
      aria-label="Project access"
      className="mx-6 mb-4 space-y-3 rounded-xl border bg-muted/40 p-4 text-sm"
    >
      <p className="text-muted-foreground">
        Access applies everywhere: this screen, tools and agents acting for someone.
      </p>
      <ul className="space-y-1.5">
        {Object.entries(project.members).map(([principal, membership]) => (
          <li key={principal} className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase"
            >
              {principal[0]}
            </span>
            <span className="flex-1 font-medium">{principal}</span>
            <span className="text-muted-foreground capitalize">{membership}</span>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void client
            .command(
              operations.projectSetMember,
              { id: project.id, principalId, role: role === 'remove' ? null : role },
              { expectedRevisions: { [`project:${project.id}`]: project.revision } },
            )
            .then(() => setPrincipalId(''))
            .catch((error) => onError(message(error)));
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="member">Person</Label>
          <Input
            id="member"
            placeholder="User ID"
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
        <Button type="submit">Update access</Button>
      </form>
    </section>
  );
}

/**
 * The agent beside the work. A run sees this project through the UI session and changes it only
 * through the same commands this screen uses; its activity and questions appear below.
 */
function AgentPanel({
  project,
  ui,
  busy,
  action,
  onError,
}: {
  project: Project;
  ui: ReturnType<typeof useUiSession>;
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
          onClick={() =>
            void action(async () => {
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
            })
          }
        >
          {demo ? 'Create tasks from brief' : 'Ask the agent'}
        </Button>
      </div>
      {ui.review && (
        <div className="space-y-2 rounded-xl border-2 border-warning/60 p-3">
          <h3 className="font-medium">{ui.review.title}</h3>
          <p className="text-sm text-muted-foreground">{ui.review.operations.join(', ')}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void ui.acknowledgeReview(true)}>
              Acknowledge review
            </Button>
            <Button size="sm" variant="outline" onClick={() => void ui.acknowledgeReview(false)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Activity</h3>
        <RunPanel onError={onError} />
      </div>
      <details className="rounded-xl border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Agent to use</summary>
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            {demo
              ? 'The offline demo runs locally without an account. Provider agents use the same tool contract.'
              : agent.harnessId === 'codex'
                ? 'Uses the selected ChatGPT plan. There is no automatic API-key fallback.'
                : 'Uses your selected provider API key.'}
          </p>
          <Accounts selection={agent} onSelect={setAgent} onError={onError} />
        </div>
      </details>
    </aside>
  );
}
