import { useRef, useState } from 'react';
import { operations } from '../../contracts';
import { OsProvenanceNotice } from '@/components/os-provenance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePreparedInput, type PreparedInput } from '@/lib/os-deliveries';
import { client } from '@/lib/session';
import type { Project } from './shared';

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** The prefilled fields, editable; one idempotency key per prefill, so a retry adds one task. */
function PreparedFields({
  project,
  prepared,
  busy,
  action,
  onDone,
}: {
  project: Project;
  prepared: PreparedInput;
  busy: boolean;
  action: (work: () => Promise<unknown>) => Promise<void>;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(text(prepared.input.title).slice(0, 200));
  const [description, setDescription] = useState(text(prepared.input.description));
  const key = useRef(crypto.randomUUID());
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void action(async () => {
          await client.command(
            operations.taskCreate,
            { projectId: project.id, title, ...(description ? { description } : {}) },
            { idempotencyKey: key.current },
          );
          onDone();
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="prepared-title">Title</Label>
        <Input
          id="prepared-title"
          required
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="prepared-description">Description</Label>
        <Textarea
          id="prepared-description"
          rows={6}
          maxLength={10_000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={busy}>
        Add task to {project.name}
      </Button>
    </form>
  );
}

/**
 * A task an OS request prefilled, such as a text file opened with the application. It shows
 * where the values came from and is created in the open project only when the person adds it;
 * discarding drops the prefill. An archived project takes no new tasks, so it shows nothing.
 */
export function PreparedTask({
  project,
  busy,
  action,
}: {
  project: Project;
  busy: boolean;
  action: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const { prepared, dismiss } = usePreparedInput(operations.taskCreate.id);
  if (!prepared || project.archived) return null;
  return (
    <section aria-label="Prefilled task" className="mx-6 mb-4 space-y-3 rounded-xl border p-4">
      <OsProvenanceNotice provenance={prepared.provenance} prepared onDismiss={dismiss} />
      <PreparedFields
        key={prepared.id}
        project={project}
        prepared={prepared}
        busy={busy}
        action={action}
        onDone={dismiss}
      />
    </section>
  );
}
