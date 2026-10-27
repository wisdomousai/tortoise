import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { live } from '@/lib/session';
import { operations } from '../../contracts';
import type { CaptureKind, SurveyScope } from '../../domain';

const kinds = ['nameplate', 'overview', 'label', 'defect', 'schematic'] as const;

const toggle = <T,>(list: readonly T[], item: T, on: boolean) =>
  on ? [...new Set([...list, item])] : list.filter((entry) => entry !== item);

/** A survey's scope: the subtrees to visit and the kinds of capture wanted there. */
export function SurveyScopeEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const tree = useQuery(live.liveQueryOptions(operations.tree, { depth: 2 }));
  const scope = value as Partial<SurveyScope>;
  const roots = scope.roots ?? [];
  const wanted = scope.kinds ?? [];
  // A new survey asks for nameplates until the planner says otherwise.
  useEffect(() => {
    if (!scope.kinds) onChange({ roots, kinds: ['nameplate'] satisfies CaptureKind[] });
  });
  return (
    <div className="space-y-3">
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Subtrees</legend>
        <div className="flex max-h-48 flex-col overflow-auto text-sm">
          {(tree.data?.items ?? []).map((node) => (
            <label
              key={node.id}
              className="flex items-center gap-2 py-0.5"
              style={{ paddingLeft: `${node.depth}rem` }}
            >
              <input
                type="checkbox"
                checked={roots.includes(node.id)}
                onChange={(event) =>
                  onChange({ roots: toggle(roots, node.id, event.target.checked), kinds: wanted })
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
              checked={wanted.includes(kind)}
              onChange={(event) =>
                onChange({ roots, kinds: toggle(wanted, kind, event.target.checked) })
              }
            />
            {kind}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
