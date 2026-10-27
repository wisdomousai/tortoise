import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useCommand } from '@agent-native/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { transport } from '@/lib/session';
import { operations } from '../../contracts';
import { ErrorText, quietly } from '../shared';

interface Field {
  name: string;
  value: string;
  confidence: number;
  attention: boolean;
  source: { digest: string; region?: { x: number; y: number; width: number; height: number } };
}

/**
 * The values the model read, editable, each with its confidence. Low-confidence values are
 * flagged; focusing a value outlines where on the photo it was read. Unticked values are dropped.
 */
export function ProposalForm({
  reportId,
  fields,
  onFocusField,
}: {
  /** The reading's report: accepting it accepts the capture with these values. */
  reportId: string;
  fields: readonly Field[];
  onFocusField: (field: Field | undefined) => void;
}) {
  const accept = useCommand(transport, operations.extractionAccept);
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((field) => [field.name, field.value])),
  );
  const [kept, setKept] = useState(() => new Set(fields.map((field) => field.name)));
  const flagged = fields.filter((field) => field.attention).length;
  const submit = () => {
    const chosen = Object.fromEntries(
      Object.entries(values)
        .filter(([name, value]) => kept.has(name) && value.trim())
        .map(([name, value]) => [name, value.trim()]),
    );
    void quietly(accept.execute({ id: reportId, values: chosen }));
  };
  return (
    <form
      aria-label="Proposal"
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        {flagged
          ? `${flagged} value${flagged > 1 ? 's' : ''} to check against the photo.`
          : 'Check the values against the photo.'}
      </p>
      {fields.map((field) => (
        <div key={field.name} className="grid grid-cols-[auto_8rem_1fr] items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label={`Keep ${field.name}`}
            checked={kept.has(field.name)}
            onChange={(event) =>
              setKept((current) => {
                const next = new Set(current);
                if (event.target.checked) next.add(field.name);
                else next.delete(field.name);
                return next;
              })
            }
          />
          <label
            htmlFor={`field-${field.name}`}
            className="flex items-center gap-1 text-muted-foreground"
          >
            {field.attention && <TriangleAlert className="size-4 text-amber-500" aria-hidden />}
            {field.name}
          </label>
          <Input
            id={`field-${field.name}`}
            value={values[field.name] ?? ''}
            title={`Confidence ${Math.round(field.confidence * 100)}%`}
            aria-invalid={field.attention}
            aria-description={
              field.attention ? 'Low confidence: check against the photo' : undefined
            }
            onFocus={() => onFocusField(field)}
            onBlur={() => onFocusField(undefined)}
            onChange={(event) =>
              setValues((current) => ({ ...current, [field.name]: event.target.value }))
            }
          />
        </div>
      ))}
      <Button type="submit" disabled={accept.pending || kept.size === 0}>
        Accept onto the node
      </Button>
      <ErrorText error={accept.error} />
    </form>
  );
}
