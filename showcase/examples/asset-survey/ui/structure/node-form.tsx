import { useState } from 'react';
import { useCommand } from '@tortoise/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { transport } from '@/lib/session';
import { operations } from '../../contracts';
import { schemeIds, schemes, type SchemeId } from '../../contracts/schemes';
import { ErrorText } from '../shared';

/** Add a node under a parent; the hub validates the designation against its scheme. */
export function NodeForm({
  parents,
}: {
  parents: readonly { id: string; designation: string; name: string; depth: number }[];
}) {
  const create = useCommand(transport, operations.nodeCreate);
  const [parentId, setParentId] = useState('');
  const [scheme, setScheme] = useState<SchemeId>('iec81346');
  const [designation, setDesignation] = useState('');
  const [name, setName] = useState('');
  const submit = async () => {
    try {
      await create.execute({
        ...(parentId ? { parentId } : {}),
        scheme,
        designation,
        name: name.trim(),
      });
      setDesignation('');
      setName('');
    } catch {
      // Shown through create.error.
    }
  };
  return (
    <form
      aria-label="Add node"
      className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_auto_1fr_1.5fr_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="node-parent">Parent</Label>
        <NativeSelect
          id="node-parent"
          className="w-full"
          value={parentId}
          onChange={(event) => setParentId(event.target.value)}
        >
          <option value="">No parent (root)</option>
          {parents.map((parent) => (
            <option key={parent.id} value={parent.id}>
              {'  '.repeat(parent.depth)}
              {parent.designation} {parent.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="node-scheme">Scheme</Label>
        <NativeSelect
          id="node-scheme"
          value={scheme}
          onChange={(event) => setScheme(event.target.value as SchemeId)}
        >
          {schemeIds.map((id) => (
            <option key={id} value={id}>
              {schemes[id].label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="node-designation">Designation</Label>
        <Input
          id="node-designation"
          className="font-mono"
          placeholder={schemes[scheme].example}
          value={designation}
          onChange={(event) => setDesignation(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="node-name">Name</Label>
        <Input id="node-name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <Button type="submit" disabled={create.pending || !designation || !name.trim()}>
        Add node
      </Button>
      <div className="sm:col-span-5">
        <ErrorText error={create.error} />
      </div>
    </form>
  );
}
