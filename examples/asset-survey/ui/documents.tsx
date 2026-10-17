import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCommand } from '@agent-native/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { live, transport } from '@/lib/session';
import { operations } from '../contracts';
import { blobUrl, Empty, ErrorText, Page, when } from './shared';

const kinds = ['schematic', 'plan', 'datasheet', 'manual', 'other'] as const;
type Kind = (typeof kinds)[number];

/** Schematics, plans and datasheets of the site, optionally attached to a node. */
export function DocumentsScreen() {
  const documents = useQuery(live.liveQueryOptions(operations.documentList, {}));
  const tree = useQuery(live.liveQueryOptions(operations.tree, {}));
  const add = useCommand(transport, operations.documentAdd);
  const [file, setFile] = useState<File>();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<Kind>('schematic');
  const [nodeId, setNodeId] = useState('');
  const [error, setError] = useState<string>();
  const nodes = tree.data?.nodes ?? [];
  const designations = new Map(nodes.map((node) => [node.id, node.designation]));
  const submit = async () => {
    if (!file) return;
    setError(undefined);
    try {
      // The file goes up first; the command then files it, and the hub keeps it with the document.
      const ref = await transport.blobs!.put(
        new Uint8Array(await file.arrayBuffer()),
        file.type || 'application/pdf',
      );
      await add.execute({ title: title.trim(), kind, file: ref, ...(nodeId ? { nodeId } : {}) });
      setFile(undefined);
      setTitle('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed');
    }
  };
  return (
    <Page
      title="Documents"
      description="PDF or images up to 32 MiB. Agents read schematics to propose structure nodes."
    >
      <form
        aria-label="Add document"
        className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="document-file">File</Label>
          <Input
            id="document-file"
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              setFile(chosen);
              if (chosen && !title) setTitle(chosen.name.replace(/\.[^.]+$/, ''));
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="document-title">Title</Label>
          <Input
            id="document-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="document-kind">Kind</Label>
          <NativeSelect
            id="document-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as Kind)}
          >
            {kinds.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="document-node">Node</Label>
          <NativeSelect
            id="document-node"
            value={nodeId}
            onChange={(event) => setNodeId(event.target.value)}
          >
            <option value="">The whole site</option>
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.designation} {node.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={add.pending || !file || !title.trim()}>
            Add document
          </Button>
          <ErrorText error={error ?? add.error} />
        </div>
      </form>
      {documents.data?.items.length === 0 && <Empty>No documents yet.</Empty>}
      <ul aria-label="Documents" className="divide-y rounded-xl border bg-card text-sm">
        {(documents.data?.items ?? []).map((document) => (
          <li
            key={document.id}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
          >
            <a
              href={blobUrl(document.file.digest)}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:underline"
            >
              {document.title}
            </a>
            <span className="text-muted-foreground">
              {document.kind}
              {document.nodeId &&
                ` · ${designations.get(document.nodeId) ?? 'retired node'}`} ·{' '}
              {when(document.addedAt)}
            </span>
          </li>
        ))}
      </ul>
    </Page>
  );
}
