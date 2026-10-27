import { useRef, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { isBlobRef, type BlobRef } from '@agent-native/contracts';
import { operations } from '../../contracts';
import { OsProvenanceNotice } from '@/components/os-provenance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePreparedInput, type PreparedInput } from '@/lib/os-deliveries';
import { client } from '@/lib/session';
import type { WorkOrder } from './shared';

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const size = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** The file a prefill attaches; it is attached only when the person adds the task. */
function PreparedAttachment({ attachment }: { attachment: BlobRef }) {
  return (
    <p className="text-muted-foreground flex items-center gap-2 text-sm">
      <Paperclip className="size-4" aria-hidden />
      Attachment: {attachment.mediaType}, {size(attachment.size)}
    </p>
  );
}

/** The prefilled fields, editable; one idempotency key per prefill, so a retry adds one task. */
function PreparedFields({
  workOrder,
  prepared,
  busy,
  action,
  onDone,
}: {
  workOrder: WorkOrder;
  prepared: PreparedInput;
  busy: boolean;
  action: (work: () => Promise<unknown>) => Promise<void>;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(text(prepared.input.title).slice(0, 200));
  const [description, setDescription] = useState(text(prepared.input.description));
  const attachment = isBlobRef(prepared.input.attachment) ? prepared.input.attachment : undefined;
  const key = useRef(crypto.randomUUID());
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void action(async () => {
          await client.command(
            operations.taskCreate,
            {
              workOrderId: workOrder.id,
              title,
              ...(description ? { description } : {}),
              ...(attachment ? { attachment } : {}),
            },
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
      {attachment && <PreparedAttachment attachment={attachment} />}
      <Button type="submit" disabled={busy}>
        Add task to {workOrder.name}
      </Button>
    </form>
  );
}

/**
 * A task an OS request prefilled, such as a text file or an image opened with the application. It shows
 * where the values came from and is created in the open work order only when the person adds it;
 * discarding drops the prefill. An closed work order takes no new tasks, so it shows nothing.
 */
export function PreparedTask({
  workOrder,
  busy,
  action,
}: {
  workOrder: WorkOrder;
  busy: boolean;
  action: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const { prepared, dismiss } = usePreparedInput(operations.taskCreate.id);
  if (!prepared || workOrder.closed) return null;
  return (
    <section aria-label="Prefilled task" className="mx-6 mb-4 space-y-3 rounded-xl border p-4">
      <OsProvenanceNotice provenance={prepared.provenance} prepared onDismiss={dismiss} />
      <PreparedFields
        key={prepared.id}
        workOrder={workOrder}
        prepared={prepared}
        busy={busy}
        action={action}
        onDone={dismiss}
      />
    </section>
  );
}
