import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AnyCapability } from '@agent-native/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { client, live } from '@/lib/session';

type Query = AnyCapability & { kind: 'query' };
type Command = AnyCapability & { kind: 'command' };

export interface Assignee {
  type: string;
  id: string;
}
/** One assignee the person may pick: a person, an agent definition, a device, a peer or a target. */
export interface AssigneeOption extends Assignee {
  label: string;
}
/** An assignment as the board's list returns it. */
export interface BoardAssignment {
  id: string;
  kind: string;
  title: string;
  note?: string;
  /** What the planner filled in, in the kind's scope shape. */
  scope: unknown;
  assignee?: Assignee;
  stage: string;
  reports: number;
  unreviewed: number;
  createdAt: number;
  sentAt?: number;
  delivery?: string;
  rejection?: { code: string; message: string };
  reason?: string;
}

/** One kind on the board: its contract and generated commands, and an optional scope editor. */
export interface BoardKind {
  /** The kind as `defineAssignmentKind` returns it. */
  kind: { id: string; title: string; assigneeTypes: readonly string[] };
  create: Command;
  send: Command;
  /** An editor for the scope that labels its own fields; a JSON field when omitted. */
  scope?: (props: { value: unknown; onChange: (value: unknown) => void }) => ReactNode;
  /** What an assignment covers, under its assignee; nothing when omitted. */
  summary?: (assignment: BoardAssignment) => ReactNode;
}

const stageVariant: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'outline',
  sent: 'secondary',
  working: 'secondary',
  done: 'default',
  reviewed: 'default',
  withdrawn: 'destructive',
  closed: 'outline',
};
const refusal = (error: unknown) => {
  const code = (error as { code?: string }).code;
  if (code === 'FORBIDDEN') return 'You may not do this.';
  if (code === 'CONFLICT') return 'The assignment changed. Nothing was changed.';
  return error instanceof Error ? error.message : 'The command failed.';
};
const keyOf = (assignee: Assignee) => `${assignee.type}:${assignee.id}`;

/** A select of the assignees of the kind's assignee types; empty means "no assignee". */
function AssigneeSelect({
  id,
  options,
  assigneeTypes,
  value,
  onChange,
  empty,
}: {
  id: string;
  options: readonly AssigneeOption[];
  assigneeTypes: readonly string[];
  value: string;
  onChange: (value: string) => void;
  empty: string;
}) {
  return (
    <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{empty}</option>
      {options
        .filter((option) => assigneeTypes.includes(option.type))
        .map((option) => (
          <option key={keyOf(option)} value={keyOf(option)}>
            {option.label}
          </option>
        ))}
    </NativeSelect>
  );
}

/** Run one command and report a refusal; each click is its own attempt. */
function useAct() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const act = async (command: Command, input: Record<string, unknown>) => {
    setBusy(true);
    setMessage(undefined);
    try {
      await client.command(command, input as never);
      return true;
    } catch (error) {
      setMessage(refusal(error));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, message, act, fail: setMessage };
}

function NewAssignment({
  kind,
  assignees,
}: {
  kind: BoardKind;
  assignees: readonly AssigneeOption[];
}) {
  const { busy, message, act, fail } = useAct();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [scope, setScope] = useState<unknown>({});
  const [json, setJson] = useState('{}');
  const [assignee, setAssignee] = useState('');
  const id = (name: string) => `${kind.create.id}-${name}`;
  const submit = async () => {
    let value = scope;
    if (!kind.scope)
      try {
        value = JSON.parse(json);
      } catch {
        return fail('The scope is not valid JSON.');
      }
    const picked = assignees.find((option) => keyOf(option) === assignee);
    const created = await act(kind.create, {
      title,
      ...(note ? { note } : {}),
      scope: value,
      ...(picked ? { assignee: { type: picked.type, id: picked.id } } : {}),
    });
    if (!created) return;
    setTitle('');
    setNote('');
    setScope({});
    setJson('{}');
    setAssignee('');
  };
  return (
    <form
      aria-label={`New ${kind.kind.title}`}
      className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={id('title')}>Title</Label>
        <Input id={id('title')} value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={id('assignee')}>Assignee</Label>
        <AssigneeSelect
          id={id('assignee')}
          options={assignees}
          assigneeTypes={kind.kind.assigneeTypes}
          value={assignee}
          onChange={setAssignee}
          empty="Keep as draft"
        />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={id('note')}>
          Note <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Textarea id={id('note')} value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
      <div className="space-y-1 sm:col-span-2">
        {kind.scope ? (
          kind.scope({ value: scope, onChange: setScope })
        ) : (
          <>
            <Label htmlFor={id('scope')}>Scope</Label>
            <Textarea
              id={id('scope')}
              className="font-mono"
              value={json}
              onChange={(event) => setJson(event.target.value)}
            />
          </>
        )}
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={busy || !title}>
          {assignee ? 'Create and send' : 'Create draft'}
        </Button>
        {message && (
          <span role="alert" className="text-sm text-destructive">
            {message}
          </span>
        )}
      </div>
    </form>
  );
}

function AssignmentRow({
  assignment,
  kind,
  assignees,
  withdraw,
  close,
  aside,
}: {
  assignment: BoardAssignment;
  kind: BoardKind | undefined;
  assignees: readonly AssigneeOption[];
  withdraw: Command;
  close: Command;
  aside?: (assignment: BoardAssignment) => ReactNode;
}) {
  const { busy, message, act } = useAct();
  const [assignee, setAssignee] = useState('');
  const named = assignees.find(
    (option) => assignment.assignee && keyOf(option) === keyOf(assignment.assignee),
  );
  const who = assignment.assignee ? (named?.label ?? keyOf(assignment.assignee)) : 'No assignee';
  const open = ['sent', 'working'].includes(assignment.stage);
  const send = () => {
    const picked = assignees.find((option) => keyOf(option) === assignee);
    if (kind && picked)
      void act(kind.send, { id: assignment.id, assignee: { type: picked.type, id: picked.id } });
  };
  return (
    <li aria-label={assignment.title} className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{assignment.title}</span>
        <Badge variant={stageVariant[assignment.stage] ?? 'outline'}>{assignment.stage}</Badge>
        <Badge variant="outline">{kind?.kind.title ?? assignment.kind}</Badge>
        {assignment.unreviewed > 0 && (
          <Badge variant="secondary">{assignment.unreviewed} to review</Badge>
        )}
        {assignment.delivery === 'rejected' && <Badge variant="destructive">Refused</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">
        {who} · {assignment.reports} {assignment.reports === 1 ? 'report' : 'reports'}
        {assignment.rejection ? ` · ${assignment.rejection.message}` : ''}
        {assignment.reason ? ` · ${assignment.reason}` : ''}
      </p>
      {kind?.summary?.(assignment)}
      <div className="flex flex-wrap items-center gap-2">
        {assignment.stage === 'draft' && kind && (
          <>
            <AssigneeSelect
              id={`${assignment.id}-assignee`}
              options={assignees}
              assigneeTypes={kind.kind.assigneeTypes}
              value={assignee}
              onChange={setAssignee}
              empty="Pick an assignee"
            />
            <Button size="sm" disabled={busy || !assignee} onClick={send}>
              Send
            </Button>
          </>
        )}
        {(assignment.stage === 'draft' || open) && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void act(withdraw, { id: assignment.id })}
          >
            Withdraw
          </Button>
        )}
        {['done', 'reviewed'].includes(assignment.stage) && (
          <Button size="sm" disabled={busy} onClick={() => void act(close, { id: assignment.id })}>
            Close
          </Button>
        )}
        {aside?.(assignment)}
      </div>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </li>
  );
}

/**
 * Assignments, live, with their stage, assignee and report counts, a form per kind that creates
 * a draft or sends at once, and Send, Withdraw and Close where the stage allows them. The
 * instance decides every action, so a refusal shows on the row and changes nothing. `aside`
 * renders per-assignment actions, such as a link to its reports; `input` filters the list.
 */
export function AssignmentBoard({
  title = 'Assignments',
  list,
  withdraw,
  close,
  kinds,
  assignees,
  input = {},
  aside,
}: {
  title?: string;
  list: Query;
  withdraw: Command;
  close: Command;
  kinds: readonly BoardKind[];
  assignees: readonly AssigneeOption[];
  /** The list query's filters: kind, stage, assignee. */
  input?: Record<string, unknown>;
  aside?: (assignment: BoardAssignment) => ReactNode;
}) {
  const query = useQuery(live.liveQueryOptions(list, { limit: 100, ...input } as never));
  const data = query.data as { items: BoardAssignment[]; total: number } | undefined;
  const items = data?.items ?? [];
  const [creating, setCreating] = useState<string>();
  const kindOf = (id: string) => kinds.find((kind) => kind.kind.id === id);
  const chosen = creating ? kindOf(creating) : undefined;
  return (
    <section aria-label={title} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium">{title}</h2>
        <div className="flex flex-wrap gap-2">
          {kinds.map((kind) => (
            <Button
              key={kind.kind.id}
              size="sm"
              variant={creating === kind.kind.id ? 'secondary' : 'outline'}
              onClick={() => setCreating(creating === kind.kind.id ? undefined : kind.kind.id)}
            >
              New {kind.kind.title.toLowerCase()}
            </Button>
          ))}
        </div>
      </div>
      {chosen && <NewAssignment key={chosen.kind.id} kind={chosen} assignees={assignees} />}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No assignments.</p>
      ) : (
        <ul className="divide-y">
          {items.map((assignment) => (
            <AssignmentRow
              key={assignment.id}
              assignment={assignment}
              kind={kindOf(assignment.kind)}
              assignees={assignees}
              withdraw={withdraw}
              close={close}
              {...(aside ? { aside } : {})}
            />
          ))}
        </ul>
      )}
      {data && data.total > items.length && (
        <p className="text-xs text-muted-foreground">
          Showing {items.length} of {data.total}.
        </p>
      )}
    </section>
  );
}
