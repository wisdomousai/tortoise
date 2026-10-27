import { useState } from 'react';
import { Bell, Check, Paperclip, X } from 'lucide-react';
import { operations } from '../../contracts';
import { ConflictBanner } from '@/components/conflict-banner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { client } from '@/lib/session';
import { cn } from '@/lib/utils';
import { message, type Status, type Task } from './shared';

/** The status button moves a task one step: to do → in progress → done → to do. */
const nextStatus: Record<Status, { to: Status; verb: string }> = {
  todo: { to: 'doing', verb: 'Start' },
  doing: { to: 'done', verb: 'Finish' },
  done: { to: 'todo', verb: 'Reopen' },
};

const extensions: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/pdf': 'pdf',
};
const extensionFor = (mediaType: string) => extensions[mediaType] ?? 'bin';

/**
 * One task's commands and title draft. Editing starts from a fresh read, and a dirty draft
 * retains its original base revision even when committed data updates, so a concurrent change
 * shows as a conflict instead of being overwritten.
 */
function useTaskDraft(task: Task, onError: (message: string) => void) {
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
      onError(message(error));
    } finally {
      setPending(false);
    }
  }
  const edit = () =>
    void client
      .query(operations.taskGet, { id: task.id })
      .then((snapshot) =>
        setDraft({ title: snapshot.data.title, revision: snapshot.data.revision }),
      )
      .catch((error) => onError(message(error)));
  const advance = () =>
    void client
      .command(
        operations.taskSetStatus,
        { id: task.id, status: nextStatus[task.status].to },
        { expectedRevisions: revisions(task.revision) },
      )
      .catch((error) => onError(message(error)));
  const remove = () =>
    void client
      .command(
        operations.taskDelete,
        { id: task.id },
        { expectedRevisions: revisions(task.revision) },
      )
      .catch((error) => onError(message(error)));
  // A reminder is shown by a desktop or phone running this workspace; it waits until one is.
  const remind = () =>
    void client
      .command(operations.taskRemind, { id: task.id })
      .catch((error) => onError(message(error)));
  return { draft, setDraft, pending, conflict, save, edit, advance, remove, remind };
}

/** What happened to the last reminder, until it was shown. */
const reminderText: Partial<Record<NonNullable<Task['reminder']>, string>> = {
  pending: 'Reminder waiting for the desktop or phone app',
  rejected: 'Reminder not shown',
};

/** The round status control: empty, half filled while in progress, checked when done. */
function StatusButton({
  task,
  disabled,
  onClick,
}: {
  task: Task;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${nextStatus[task.status].verb} ${task.title}`}
      disabled={disabled}
      onClick={onClick}
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
  );
}

/** The inline title editor; while in conflict it offers no save, only the banner's choices. */
function TitleTechnician({
  title,
  conflict,
  pending,
  onTitle,
  onSave,
  onCancel,
}: {
  title: string;
  conflict: boolean;
  pending: boolean;
  onTitle: (title: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="flex flex-1 items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!conflict) onSave();
      }}
    >
      <Input
        aria-label="Edit task title"
        autoFocus
        className="h-9"
        value={title}
        onChange={(event) => onTitle(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && onCancel()}
      />
      {!conflict && (
        <>
          <Button size="sm" type="submit" disabled={pending}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </>
      )}
    </form>
  );
}

/** A dirty draft retains its original base revision even when committed data updates. */
export function TaskRow({
  task,
  closed,
  onError,
}: {
  task: Task;
  closed: boolean;
  onError: (message: string) => void;
}) {
  const { draft, setDraft, pending, conflict, save, edit, advance, remove, remind } = useTaskDraft(
    task,
    onError,
  );
  const reminder = task.reminder && reminderText[task.reminder];
  return (
    <li className="group space-y-2 px-6 py-2.5" data-testid="task-row">
      <div className="flex items-center gap-3">
        <StatusButton task={task} disabled={closed || pending} onClick={advance} />
        {draft ? (
          <TitleTechnician
            title={draft.title}
            conflict={conflict}
            pending={pending}
            onTitle={(title) => setDraft({ ...draft, title })}
            onSave={() => void save()}
            onCancel={() => setDraft(undefined)}
          />
        ) : (
          <button
            type="button"
            className={cn(
              'min-w-0 flex-1 truncate text-left text-[0.95rem] hover:underline',
              task.status === 'done' && 'text-muted-foreground line-through',
            )}
            disabled={closed}
            onClick={edit}
          >
            {task.title}
          </button>
        )}
        {task.attachment && (
          // Served by the instance to callers who may read this task, sandboxed and never
          // rendered on its origin; the browser or desktop saves it as a download.
          <Button size="icon-sm" variant="ghost" asChild>
            <a
              href={`/api/v1/blobs/${encodeURIComponent(task.attachment.digest)}`}
              download={`${task.title}.${extensionFor(task.attachment.mediaType)}`}
              aria-label={`Download the attachment of ${task.title}`}
            >
              <Paperclip />
            </a>
          </Button>
        )}
        {reminder && <span className="text-muted-foreground shrink-0 text-xs">{reminder}</span>}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Remind me about ${task.title}`}
          className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          disabled={closed || pending || task.status === 'done'}
          onClick={remind}
        >
          <Bell />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Delete ${task.title}`}
          className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          disabled={closed || pending}
          onClick={remove}
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
