import { useState } from 'react';
import { MyAssignments, type FeedItem, type SubmitReport } from '@/components/my-assignments';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { transport } from '@/lib/session';
import { extraction, operations, survey } from '../contracts';
import type { CaptureKind } from '../domain';
import { blobUrl, ErrorText, Page, valueLines } from './shared';

type BriefNode = { id: string; designation: string; name: string };

/** One capture taken at a desk: photos uploaded from files, the node, the kind and a note. */
function CaptureForm({ item, submit }: { item: FeedItem; submit: SubmitReport }) {
  const brief = item.brief as { kinds: CaptureKind[]; nodes: BriefNode[] };
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState(brief.kinds[0] ?? 'nameplate');
  const [nodeId, setNodeId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const send = async () => {
    setError(undefined);
    try {
      const photos = [];
      for (const file of files)
        photos.push(
          await transport.blobs!.put(new Uint8Array(await file.arrayBuffer()), file.type),
        );
      const body = { kind, photos, codes: [], note: note.trim(), takenAt: Date.now() };
      if (await submit(body, nodeId || undefined)) {
        setFiles([]);
        setNote('');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed');
    }
  };
  return (
    <form
      aria-label={`Capture for ${item.title}`}
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`${item.id}-photos`}>Photos</Label>
        <Input
          id={`${item.id}-photos`}
          type="file"
          multiple
          accept="image/jpeg,image/png"
          onChange={(event) => setFiles([...(event.target.files ?? [])].slice(0, 8))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${item.id}-node`}>Node</Label>
        <NativeSelect
          id={`${item.id}-node`}
          value={nodeId}
          onChange={(event) => setNodeId(event.target.value)}
        >
          <option value="">Not known</option>
          {brief.nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.designation} {node.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${item.id}-kind`}>Kind</Label>
        <NativeSelect
          id={`${item.id}-kind`}
          value={kind}
          onChange={(event) => setKind(event.target.value as CaptureKind)}
        >
          {brief.kinds.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${item.id}-note`}>Note</Label>
        <Input
          id={`${item.id}-note`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={files.length === 0}>
          Report capture
        </Button>
        <ErrorText error={error} />
      </div>
    </form>
  );
}

/** Reading a capture by hand: the photos, and one `name: value` line per value read. */
function ReadingForm({ item, submit }: { item: FeedItem; submit: SubmitReport }) {
  const brief = item.brief as { photos: { digest: string }[] };
  const [lines, setLines] = useState('');
  const fields = valueLines(lines).map(([name, value]) => ({
    name,
    value,
    confidence: 1,
    source: { digest: brief.photos[0]!.digest },
  }));
  return (
    <form
      aria-label={`Reading for ${item.title}`}
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit({ model: 'read by hand', fields }).then((done) => done && setLines(''));
      }}
    >
      <div className="flex flex-wrap gap-2">
        {brief.photos.map((photo) => (
          <img
            key={photo.digest}
            src={blobUrl(photo.digest)}
            alt="Photo to read"
            className="max-h-64 rounded-md border"
          />
        ))}
      </div>
      <Label htmlFor={`${item.id}-lines`}>Values, one per line as name: value</Label>
      <Textarea
        id={`${item.id}-lines`}
        className="font-mono"
        placeholder={'manufacturer: ABB\nserial: 1VYN0123'}
        value={lines}
        onChange={(event) => setLines(event.target.value)}
      />
      <Button type="submit" variant="secondary" disabled={fields.length === 0}>
        Report reading
      </Button>
    </form>
  );
}

/** Surveys and readings sent to the signed-in person, each with a report form. */
export function MyWorkScreen() {
  return (
    <Page
      title="My work"
      description="Surveys and readings sent to you. Report each capture or reading, then mark the work done."
    >
      <MyAssignments
        title="Sent to me"
        feed={operations.feed}
        complete={operations.complete}
        kinds={[
          {
            kind: survey,
            report: operations.surveyReport,
            form: (item, submit) => <CaptureForm item={item} submit={submit} />,
          },
          {
            kind: extraction,
            report: operations.extractionReport,
            form: (item, submit) => <ReadingForm item={item} submit={submit} />,
          },
        ]}
      />
    </Page>
  );
}
