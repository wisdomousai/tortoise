import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCommand } from '@agent-native/react';
import { noteOperations } from '@agent-native/sample-notes/contracts';
import type { AssignmentReport, PlaceReport } from '@/components/assignment-reports';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { live, transport } from '@/lib/session';
import { assignmentOperations } from '../contracts';
import { untitled, type ReviewBrief, type Verdict } from './verdict';

const MAX_NOTES = 20;

/** A note's current title, linking to it; "Note unavailable" when it is gone or hidden. */
export function NoteLink({ id }: { id: string }) {
  const note = useQuery({
    ...live.liveQueryOptions(noteOperations.noteGet, { id }),
    retry: false,
  });
  if (note.isError) return <span className="text-muted-foreground">Note unavailable</span>;
  return (
    <Link to={`/notes/${id}`} className="underline underline-offset-2">
      {note.data ? untitled(note.data.title) : '…'}
    </Link>
  );
}

/** The notes a review's scope names, as links. */
export function ScopeNotes({ ids }: { ids: readonly string[] }) {
  return (
    <ul aria-label="Notes" className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
      {ids.map((id) => (
        <li key={id}>
          <NoteLink id={id} />
        </li>
      ))}
    </ul>
  );
}

/** A review's scope: notes ticked from the list, narrowed by search, at most twenty. */
export function NotePicker({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [search, setSearch] = useState('');
  const list = useQuery(
    live.liveQueryOptions(noteOperations.noteList, { limit: 50, ...(search ? { search } : {}) }),
  );
  const picked = (value as { notes?: string[] }).notes ?? [];
  const toggle = (id: string, on: boolean) =>
    onChange({ notes: on ? [...picked, id] : picked.filter((entry) => entry !== id) });
  const items = list.data?.items ?? [];
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        Notes to review ({picked.length} of at most {MAX_NOTES})
      </legend>
      <Input
        aria-label="Search notes"
        placeholder="Search"
        className="max-w-xs"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="flex max-h-56 flex-col overflow-auto text-sm">
        {items.map((note) => {
          const checked = picked.includes(note.id);
          return (
            <label key={note.id} className="flex items-center gap-2 py-0.5">
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && picked.length >= MAX_NOTES}
                onChange={(event) => toggle(note.id, event.target.checked)}
              />
              {untitled(note.title)}
            </label>
          );
        })}
        {items.length === 0 && <span className="text-muted-foreground">No notes found.</span>}
      </div>
      {list.data && list.data.total > items.length && (
        <p className="text-xs text-muted-foreground">
          Showing {items.length} of {list.data.total}; search to find the others.
        </p>
      )}
    </fieldset>
  );
}

/** Places an unplaced report on one of the notes its review was sent with. */
export function PlaceOnNote({ report, place }: { report: AssignmentReport; place: PlaceReport }) {
  const assignment = useQuery(
    live.liveQueryOptions(assignmentOperations.get, { id: report.assignmentId }),
  );
  const notes = (assignment.data?.brief as ReviewBrief | undefined)?.notes ?? [];
  const [note, setNote] = useState('');
  if (report.subject) return null;
  return (
    <form
      aria-label={`Place report ${report.id}`}
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void place(note);
      }}
    >
      <NativeSelect
        aria-label="Note to place it on"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      >
        <option value="">Pick a note of the review</option>
        {notes.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {untitled(entry.title)}
          </option>
        ))}
      </NativeSelect>
      <Button size="sm" variant="outline" type="submit" disabled={!note}>
        Place
      </Button>
    </form>
  );
}

/**
 * Accepting a verdict into its note. The comment starts as the reporter's; an edited one is sent
 * as the reviewer's, and the instance appends it to the note in the accept command.
 */
export function AcceptVerdict({ report }: { report: AssignmentReport }) {
  const accept = useCommand(transport, assignmentOperations.reviewAccept);
  const reported = (report.body as Verdict).comment;
  const [comment, setComment] = useState(reported);
  const id = `${report.id}-accept-comment`;
  const edited = comment.trim() !== reported;
  return (
    <form
      aria-label={`Accept report ${report.id}`}
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void accept
          .execute({ id: report.id, ...(edited ? { comment: comment.trim() } : {}) })
          .catch(() => undefined);
      }}
    >
      <Label htmlFor={id}>Comment added to the note</Label>
      <Textarea
        id={id}
        maxLength={500}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          type="submit"
          disabled={accept.pending || !report.subject || !comment.trim()}
        >
          Accept into the note
        </Button>
        {!report.subject && (
          <span className="text-sm text-muted-foreground">Place it on a note first.</span>
        )}
        {accept.error && (
          <span role="alert" className="text-sm text-destructive">
            {accept.error}
          </span>
        )}
      </div>
    </form>
  );
}
