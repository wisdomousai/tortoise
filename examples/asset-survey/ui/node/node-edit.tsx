import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCommand } from '@agent-native/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { live, transport } from '@/lib/session';
import { operations } from '../../contracts';
import { ErrorText, quietly } from '../shared';

/** Correct a node's designation or name, move it under another parent, or retire it. */
export function NodeEdit({
  node,
}: {
  node: { id: string; designation: string; name: string; parentId?: string };
}) {
  const update = useCommand(transport, operations.nodeUpdate);
  const move = useCommand(transport, operations.nodeMove);
  const retire = useCommand(transport, operations.nodeRetire);
  const tree = useQuery(live.liveQueryOptions(operations.tree, {}));
  const [designation, setDesignation] = useState(node.designation);
  const [name, setName] = useState(node.name);
  const parents = (tree.data?.nodes ?? []).filter(
    (candidate) => candidate.id !== node.id && candidate.source !== 'proposed',
  );
  return (
    <section aria-label="Edit node" className="space-y-3 rounded-xl border bg-card p-4">
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void quietly(update.execute({ id: node.id, designation, name: name.trim() }));
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="edit-designation">Designation</Label>
          <Input
            id="edit-designation"
            className="font-mono"
            value={designation}
            onChange={(event) => setDesignation(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-name">Name</Label>
          <Input id="edit-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <Button type="submit" variant="outline" disabled={update.pending || !name.trim()}>
          Save
        </Button>
      </form>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="edit-parent">Parent</Label>
          <NativeSelect
            id="edit-parent"
            value={node.parentId ?? ''}
            disabled={move.pending}
            onChange={(event) =>
              void quietly(move.execute({ id: node.id, parentId: event.target.value || null }))
            }
          >
            <option value="">No parent (root)</option>
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.designation} {parent.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button
          variant="destructive"
          disabled={retire.pending}
          onClick={() => void quietly(retire.execute({ id: node.id }))}
        >
          Retire node
        </Button>
      </div>
      <ErrorText error={update.error ?? move.error ?? retire.error} />
    </section>
  );
}
