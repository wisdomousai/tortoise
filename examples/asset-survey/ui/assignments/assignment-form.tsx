import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCommand } from '@agent-native/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { live, transport } from '@/lib/session';
import { operations } from '../../contracts';
import { ErrorText } from '../shared';

const kinds = ['nameplate', 'overview', 'label', 'defect', 'schematic'] as const;
type Kind = (typeof kinds)[number];

const toggle = <T,>(set: Set<T>, item: T, on: boolean) => {
  const next = new Set(set);
  if (on) next.add(item);
  else next.delete(item);
  return next;
};

/** Plan field work: a title, the subtrees to visit and the kinds of capture wanted there. */
export function AssignmentForm() {
  const tree = useQuery(live.liveQueryOptions(operations.tree, {}));
  const create = useCommand(transport, operations.assignmentCreate);
  const [title, setTitle] = useState('');
  const [roots, setRoots] = useState(new Set<string>());
  const [wanted, setWanted] = useState(new Set<Kind>(['nameplate']));
  const nodes = (tree.data?.nodes ?? []).filter(
    (node) => node.source !== 'proposed' && node.depth < 3,
  );
  const submit = async () => {
    try {
      await create.execute({ title: title.trim(), roots: [...roots], kinds: [...wanted] });
      setTitle('');
      setRoots(new Set());
    } catch {
      // Shown through create.error.
    }
  };
  return (
    <form
      aria-label="New assignment"
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="assignment-title">Title</Label>
        <Input
          id="assignment-title"
          placeholder="Nameplates of all breakers under =G1"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Subtrees</legend>
        <div className="flex max-h-48 flex-col overflow-auto text-sm">
          {nodes.map((node) => (
            <label
              key={node.id}
              className="flex items-center gap-2 py-0.5"
              style={{ paddingLeft: `${node.depth}rem` }}
            >
              <input
                type="checkbox"
                checked={roots.has(node.id)}
                onChange={(event) =>
                  setRoots((current) => toggle(current, node.id, event.target.checked))
                }
              />
              <span className="font-mono">{node.designation}</span> {node.name}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="mb-1 text-sm font-medium">Capture</legend>
        {kinds.map((kind) => (
          <label key={kind} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={wanted.has(kind)}
              onChange={(event) =>
                setWanted((current) => toggle(current, kind, event.target.checked))
              }
            />
            {kind}
          </label>
        ))}
      </fieldset>
      <Button
        type="submit"
        disabled={create.pending || !title.trim() || !roots.size || !wanted.size}
      >
        Create assignment
      </Button>
      <ErrorText error={create.error} />
    </form>
  );
}
