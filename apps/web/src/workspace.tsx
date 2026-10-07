import { useEffect, useState } from 'react';
import { createHttpTransport, createClient } from '@agent-native/client';
import { useLiveQuery } from '@agent-native/react';
import { operations } from '../../../examples/project-tasks/contracts';
import type { OutputOf } from '@agent-native/contracts';
import { Accounts, type AgentSelection } from './accounts';
import { useUiSession } from './ui-session';
import { hostJson } from './host-client';

const transport = createHttpTransport({ baseUrl: location.origin });
const client = createClient(transport);
type Task = OutputOf<typeof operations.taskGet>;
type Run = {
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

/** The screen uses capability bindings. No domain state is changed locally on command success. */
export function App() {
  const projects = useLiveQuery(transport, operations.projectList, {});
  const [selected, setSelected] = useState<string>('');
  const active =
    projects.data?.items.find((project) => project.id === selected) ?? projects.data?.items[0];
  const tasks = useLiveQuery(
    transport,
    operations.taskList,
    active ? { projectId: active.id } : {},
  );
  const [projectName, setProjectName] = useState('');
  const [taskName, setTaskName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
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
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const update = async () => {
      try {
        const response = await fetch('/api/v1/runs', { signal: controller.signal });
        if (response.ok) setRuns((await response.json()) as Run[]);
      } catch {}
      if (!controller.signal.aborted) timer = setTimeout(update, 750);
    };
    void update();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  const completed = tasks.data?.items.filter((task) => task.status === 'done').length ?? 0;
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/">
          ◈ <span>Agent Native</span>
        </a>
        <p className="eyebrow">YOUR WORKSPACE</p>
        <h1>Projects</h1>
        <nav aria-label="Projects">
          {projects.data?.items.map((project) => (
            <button
              className={`project ${active?.id === project.id ? 'selected' : ''}`}
              key={project.id}
              onClick={() => setSelected(project.id)}
            >
              <span>{project.name}</span>
              {project.archived && <small>Archived</small>}
            </button>
          ))}
        </nav>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void action(async () => {
              const receipt = await client.command(operations.projectCreate, { name: projectName });
              setSelected(receipt.result.id);
              setProjectName('');
            });
          }}
        >
          <label htmlFor="project-name">New project</label>
          <input
            id="project-name"
            placeholder="Project name"
            required
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
          />
          <button disabled={busy} className="secondary">
            Create project
          </button>
        </form>
        <div className="sidebar-note">
          <span className="dot" />
          Local authority<p>UI, agents and tools share the same workspace.</p>
          <a href="/api/v1/contract" target="_blank" rel="noreferrer">
            Explore the interaction contract ↗
          </a>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">PROJECT / OVERVIEW</p>
            <h2>{active?.name ?? 'Your next project'}</h2>
            <p>
              {active
                ? `${completed} complete · ${tasks.data?.count ?? 0} tasks`
                : 'Create a project to begin. Your data stays on this computer.'}
            </p>
          </div>
          {active && (
            <button
              className="secondary"
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
            </button>
          )}
        </header>
        {(error || projects.error || tasks.error) && (
          <div role="alert" className="error">
            {error || projects.error || tasks.error}
          </div>
        )}
        <div className="workspace-grid">
          <section className="tasks-panel">
            <div className="section-heading">
              <h3>Tasks</h3>
              <span className="badge">Live</span>
            </div>
            {active && !active.archived && (
              <form
                className="task-create"
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
                <input
                  aria-label="New task title"
                  required
                  placeholder="What needs to happen?"
                  value={taskName}
                  onChange={(event) => setTaskName(event.target.value)}
                />
                <button disabled={busy}>Add task</button>
              </form>
            )}
            {tasks.loading && <p role="status">Loading workspace…</p>}
            {!tasks.loading && !tasks.data?.items.length && (
              <div className="empty">
                <div>◇</div>
                <h4>A clear place to start</h4>
                <p>Add a task yourself, or turn a brief into tasks with the agent.</p>
              </div>
            )}
            <div className="task-list">
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
          </section>
          <section className="agent-panel">
            <div className="section-heading">
              <h3>Agent workspace</h3>
              <span className="badge neutral">
                {agent.harnessId === 'deterministic' ? 'Deterministic demo' : agent.harnessId}
              </span>
            </div>
            <p>
              {agent.harnessId === 'deterministic'
                ? 'Turn a short plan into tasks. Each line becomes a task through the same commands used by this screen.'
                : 'Ask the selected model to work on this project through the application tools.'}
            </p>
            <label htmlFor="brief">Project brief</label>
            <textarea
              id="brief"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              rows={5}
            />
            <button
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
              {agent.harnessId === 'deterministic' ? 'Create tasks from brief' : 'Run agent'}{' '}
              <span>↗</span>
            </button>
            <small className="hint">
              {agent.harnessId === 'deterministic'
                ? 'Runs locally without an account. Provider adapters use the same tool contract.'
                : agent.harnessId === 'codex'
                  ? 'Uses the selected ChatGPT plan. There is no automatic API-key fallback.'
                  : 'Uses your selected provider API key.'}
            </small>
            <Accounts selection={agent} onSelect={setAgent} onError={setError} />
            {ui.review && (
              <div className="review">
                <h4>{ui.review.title}</h4>
                <p>{ui.review.operations.join(', ')}</p>
                <button onClick={() => void ui.acknowledgeReview(true)}>Acknowledge review</button>
                <button className="secondary" onClick={() => void ui.acknowledgeReview(false)}>
                  Dismiss
                </button>
              </div>
            )}
            <h4>Run activity</h4>
            {runs.length ? (
              runs
                .slice(-5)
                .reverse()
                .map((run) => <RunCard key={run.id} run={run} onError={setError} />)
            ) : (
              <p className="hint">Activity appears here when a run starts.</p>
            )}
          </section>
        </div>
        <footer>One contract. Shared commands. Visible changes.</footer>
      </main>
    </div>
  );
}

function RunCard({ run, onError }: { run: Run; onError: (message: string) => void }) {
  const [answer, setAnswer] = useState('');
  const [pending, setPending] = useState(false);
  const request = run.state.startsWith('awaiting-')
    ? run.events.filter((event) => event.type === 'question' || event.type === 'approval').at(-1)
    : undefined;
  async function respond(value: string | boolean) {
    if (!request?.requestId) return;
    setPending(true);
    try {
      await hostJson(`runs/${run.id}/respond`, {
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
  return (
    <article className="run">
      <strong>{run.state}</strong>
      <small>{run.id.slice(0, 8)}</small>
      <p>
        {run.failure?.message ??
          run.events
            .filter((event) => event.text || event.operation)
            .slice(-1)
            .map((event) => event.text ?? event.operation)
            .join('')}
      </p>
      {request && (
        <div className="request">
          <p>{request.message}</p>
          {request.type === 'approval' ? (
            <>
              <button disabled={pending} onClick={() => void respond(true)}>
                Approve
              </button>
              <button disabled={pending} className="secondary" onClick={() => void respond(false)}>
                Decline
              </button>
            </>
          ) : request.choices?.length ? (
            request.choices.map((choice) => (
              <button
                key={choice}
                disabled={pending}
                className="secondary"
                onClick={() => void respond(choice)}
              >
                {choice}
              </button>
            ))
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void respond(answer);
              }}
            >
              <input
                aria-label="Answer agent question"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                required
              />
              <button disabled={pending}>Send answer</button>
            </form>
          )}
        </div>
      )}
      {!['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.state) && (
        <button
          className="secondary"
          onClick={() =>
            void hostJson(`runs/${run.id}/cancel`, {}).catch((error) => onError(error.message))
          }
        >
          Cancel run
        </button>
      )}
    </article>
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
  const conflict = draft && draft.revision !== task.revision;
  async function save() {
    if (!draft) return;
    setPending(true);
    try {
      await client.command(
        operations.taskUpdate,
        { id: task.id, title: draft.title },
        { expectedRevisions: { [`task:${task.id}`]: draft.revision } },
      );
      setDraft(undefined);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setPending(false);
    }
  }
  return (
    <article className="task" data-testid="task-row">
      <div className="task-main">
        <select
          aria-label={`Status of ${task.title}`}
          value={task.status}
          disabled={archived || pending}
          onChange={(event) => {
            const status = event.target.value as Task['status'];
            void client
              .command(
                operations.taskSetStatus,
                { id: task.id, status },
                { expectedRevisions: { [`task:${task.id}`]: task.revision } },
              )
              .catch((error) => onError(error.message));
          }}
        >
          <option value="todo">To do</option>
          <option value="doing">In progress</option>
          <option value="done">Done</option>
        </select>
        {draft ? (
          <input
            aria-label="Edit task title"
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        ) : (
          <button
            className="task-title"
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
        <small>v{task.revision}</small>
        <button
          className="icon-button"
          aria-label={`Delete ${task.title}`}
          disabled={archived || pending}
          onClick={() =>
            void client
              .command(
                operations.taskDelete,
                { id: task.id },
                { expectedRevisions: { [`task:${task.id}`]: task.revision } },
              )
              .catch((error) => onError(error.message))
          }
        >
          ×
        </button>
      </div>
      {draft && (
        <div className="draft-actions">
          {conflict && <span role="status">Changed elsewhere. Your draft is preserved.</span>}
          <button disabled={pending || !!conflict} onClick={() => void save()}>
            Save
          </button>
          <button className="secondary" onClick={() => setDraft(undefined)}>
            Discard draft
          </button>
          {conflict && (
            <button
              className="secondary"
              onClick={() => setDraft({ ...draft, revision: task.revision })}
            >
              Use latest revision
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function ProjectAccess({ id, onError }: { id: string; onError: (message: string) => void }) {
  const project = useLiveQuery(transport, operations.projectGet, { id });
  const [principalId, setPrincipalId] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer' | 'owner' | 'remove'>('viewer');
  if (!project.data?.members) return null;
  return (
    <details className="access">
      <summary>Project access</summary>
      <p>Membership controls apply to UI, tools and delegated runs.</p>
      <ul>
        {Object.entries(project.data.members).map(([principal, membership]) => (
          <li key={principal}>
            {principal} <small>{membership}</small>
          </li>
        ))}
      </ul>
      <form
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
        <label htmlFor="member">Principal ID</label>
        <input
          id="member"
          value={principalId}
          onChange={(event) => setPrincipalId(event.target.value)}
          required
        />
        <label htmlFor="member-role">Role</label>
        <select
          id="member-role"
          value={role}
          onChange={(event) => setRole(event.target.value as typeof role)}
        >
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
          <option value="owner">Owner</option>
          <option value="remove">Remove access</option>
        </select>
        <button>Update access</button>
      </form>
    </details>
  );
}
