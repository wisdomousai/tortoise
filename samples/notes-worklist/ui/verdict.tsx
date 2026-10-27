import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { SubmitReport } from '@/components/my-assignments';
import type { WorklistReport } from '@/components/worklist';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { live } from '@/lib/session';
import { worklistOperations, type review } from '../contracts';

// notes-assignments has views like these, but the web build generates styles only for classes in
// this application's directory and the frame, so this application keeps its own.
type Brief = z.output<typeof review.brief>;
type Verdict = z.output<typeof review.report>;

const untitled = (title: string) => title || 'Untitled note';

/** The notes a review covers, as notes-assignments sent them. */
export function BriefNotes({ brief }: { brief: Record<string, unknown> }) {
  const { notes } = brief as Brief;
  return (
    <ol aria-label="Notes to review" className="space-y-2">
      {notes.map((note) => (
        <li key={note.id} className="rounded-md bg-muted/50 p-3">
          <p className="text-sm font-medium">{untitled(note.title)}</p>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{note.text}</p>
        </li>
      ))}
    </ol>
  );
}

/**
 * A verdict on one note of the brief: the note, keep or revise, and a comment. After a report is
 * recorded the form moves on to the next note.
 */
export function VerdictForm({
  item,
  submit,
}: {
  item: { id: string; title: string; brief: Record<string, unknown> };
  submit: SubmitReport;
}) {
  const { notes } = item.brief as Brief;
  const [note, setNote] = useState(notes[0]?.id ?? '');
  const [verdict, setVerdict] = useState<Verdict['verdict']>('keep');
  const [comment, setComment] = useState('');
  const id = (name: string) => `${item.id}-${name}`;
  const next = () => {
    const at = notes.findIndex((entry) => entry.id === note);
    setNote(notes[(at + 1) % notes.length]?.id ?? '');
    setVerdict('keep');
    setComment('');
  };
  return (
    <form
      aria-label={`Verdict on ${item.title}`}
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit({ verdict, comment: comment.trim() }, note).then((done) => done && next());
      }}
    >
      <div className="flex flex-wrap items-start gap-6">
        <div className="space-y-1">
          <Label htmlFor={id('note')}>Note</Label>
          <NativeSelect
            id={id('note')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          >
            {notes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {untitled(entry.title)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Verdict</legend>
          <div className="flex h-9 items-center gap-4 text-sm">
            {(['keep', 'revise'] as const).map((choice) => (
              <label key={choice} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={id('verdict')}
                  checked={verdict === choice}
                  onChange={() => setVerdict(choice)}
                />
                {choice === 'keep' ? 'Keep' : 'Revise'}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="space-y-1">
        <Label htmlFor={id('comment')}>Comment</Label>
        <Textarea
          id={id('comment')}
          maxLength={500}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </div>
      <div>
        <Button type="submit" variant="secondary" disabled={!note || !comment.trim()}>
          Report
        </Button>
      </div>
    </form>
  );
}

/** A verdict as recorded: keep or revise, and the comment. */
export function VerdictView({ body }: { body: Record<string, unknown> }) {
  const { verdict, comment } = body as Verdict;
  return (
    <p className="flex flex-wrap items-baseline gap-2 text-sm">
      <Badge variant={verdict === 'revise' ? 'secondary' : 'outline'}>
        {verdict === 'revise' ? 'Revise' : 'Keep'}
      </Badge>
      <span>{comment}</span>
    </p>
  );
}

/** The note a recorded report is about, named from its review's brief. */
export function BriefSubject({ report }: { report: WorklistReport }) {
  const assignment = useQuery(
    live.liveQueryOptions(worklistOperations.assignmentGet, { id: report.assignmentId }),
  );
  if (!assignment.data) return null;
  const note = (assignment.data.brief as Brief).notes.find((entry) => entry.id === report.subject);
  return (
    <Badge variant="outline">{note ? untitled(note.title) : 'A note outside the review'}</Badge>
  );
}
