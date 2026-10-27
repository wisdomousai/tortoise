import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCommand } from '@agent-native/react';
import { requestOperations } from '@agent-native/pattern-base/contracts';
import type { AssignmentReport, LinkReport } from '@/components/assignment-reports';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { live, transport } from '@/lib/session';
import { assignmentOperations } from '../contracts';
import type { RoundBrief } from './round';

const MAX_TRANSFORMERS = 20;

type Scope = { substation?: string; transformers?: string[] };

/** A round's scope as it reads on the board: the substation and its transformers. */
export function ScopeTransformers({ scope }: { scope: unknown }) {
  const { substation, transformers = [] } = scope as Scope;
  return (
    <p className="text-sm">
      {substation} <span className="text-muted-foreground">· {transformers.join(', ')}</span>
    </p>
  );
}

/** A transformer the lab has no test request for yet, added to the round by name. */
function AddTransformer({ full, onAdd }: { full: boolean; onAdd: (transformer: string) => void }) {
  const [added, setAdded] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label="Transformer to add"
        placeholder="TR-40517"
        className="max-w-xs"
        maxLength={64}
        value={added}
        onChange={(event) => setAdded(event.target.value)}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!added.trim() || full}
        onClick={() => {
          onAdd(added.trim());
          setAdded('');
        }}
      >
        Add transformer
      </Button>
    </div>
  );
}

/**
 * A round's scope: the substation, and at most twenty transformers ticked from those the lab has
 * test requests for or added by name.
 */
export function TransformerPicker({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [search, setSearch] = useState('');
  const list = useQuery(
    live.liveQueryOptions(requestOperations.requestList, {
      limit: 50,
      ...(search ? { search } : {}),
    }),
  );
  const scope = value as Scope;
  const picked = scope.transformers ?? [];
  const set = (next: Scope) =>
    onChange({ substation: scope.substation ?? '', transformers: picked, ...next });
  const toggle = (transformer: string, on: boolean) =>
    set({
      transformers: on ? [...picked, transformer] : picked.filter((entry) => entry !== transformer),
    });
  const known = [...new Set((list.data?.items ?? []).map((request) => request.transformer))];
  const shown = [...picked.filter((entry) => !known.includes(entry)), ...known];
  const full = picked.length >= MAX_TRANSFORMERS;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        Transformers ({picked.length} of at most {MAX_TRANSFORMERS})
      </legend>
      <div className="space-y-1">
        <Label htmlFor="sampling-substation">Substation</Label>
        <Input
          id="sampling-substation"
          className="max-w-xs"
          maxLength={64}
          value={scope.substation ?? ''}
          onChange={(event) => set({ substation: event.target.value })}
        />
      </div>
      <Input
        aria-label="Search transformers"
        placeholder="Search"
        className="max-w-xs"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="flex max-h-56 flex-col overflow-auto text-sm">
        {shown.map((transformer) => {
          const checked = picked.includes(transformer);
          return (
            <label key={transformer} className="flex items-center gap-2 py-0.5">
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && full}
                onChange={(event) => toggle(transformer, event.target.checked)}
              />
              {transformer}
            </label>
          );
        })}
        {shown.length === 0 && (
          <span className="text-muted-foreground">No transformers in the lab yet.</span>
        )}
      </div>
      <AddTransformer
        full={full}
        onAdd={(transformer) => {
          if (!picked.includes(transformer)) toggle(transformer, true);
        }}
      />
    </fieldset>
  );
}

/** Links an unlinked report to one of the transformers its round was sent with. */
export function LinkToTransformer({
  report,
  link,
}: {
  report: AssignmentReport;
  link: LinkReport;
}) {
  const assignment = useQuery(
    live.liveQueryOptions(assignmentOperations.get, { id: report.assignmentId }),
  );
  const transformers = (assignment.data?.brief as RoundBrief | undefined)?.transformers ?? [];
  const [transformer, setTransformer] = useState('');
  if (report.subject) return null;
  return (
    <form
      aria-label={`Link report ${report.id}`}
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void link(transformer);
      }}
    >
      <NativeSelect
        aria-label="Transformer to link it to"
        value={transformer}
        onChange={(event) => setTransformer(event.target.value)}
      >
        <option value="">Pick a transformer of the round</option>
        {transformers.map((entry) => (
          <option key={entry.transformer} value={entry.transformer}>
            {entry.transformer}
          </option>
        ))}
      </NativeSelect>
      <Button size="sm" variant="outline" type="submit" disabled={!transformer}>
        Link
      </Button>
    </form>
  );
}

/**
 * Accepting a sample submits a test request for it, with the report's description and the
 * method the technician assigns here. An empty method leaves it for a technician to assign on the
 * test request.
 */
export function AcceptSample({ report }: { report: AssignmentReport }) {
  const accept = useCommand(transport, assignmentOperations.samplingAccept);
  const [method, setMethod] = useState('');
  const id = `${report.id}-accept-method`;
  return (
    <form
      aria-label={`Accept report ${report.id}`}
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void accept
          .execute({ id: report.id, ...(method.trim() ? { method: method.trim() } : {}) })
          .catch(() => undefined);
      }}
    >
      <Label htmlFor={id}>
        Test method <span className="text-muted-foreground">(optional)</span>
      </Label>
      <Input
        id={id}
        maxLength={200}
        placeholder="IEC 60567 dissolved gas analysis"
        value={method}
        onChange={(event) => setMethod(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" type="submit" disabled={accept.pending || !report.subject}>
          Submit test request
        </Button>
        {!report.subject && (
          <span className="text-sm text-muted-foreground">Link it to a transformer first.</span>
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
