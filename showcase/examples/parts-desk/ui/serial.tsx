import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import type { OutputOf } from '@tortoise/contracts';
import { live } from '@/lib/session';
import { operations } from '../contracts';

export type FoundTransformer = OutputOf<typeof operations.transformerFind>['items'][number];

/**
 * The serial as the desk types it: upper case, and `TR-` in front when the caller reads out only
 * the digits.
 */
export const serialText = (text: string) => {
  const trimmed = text.trim().toUpperCase();
  return /^\d/.test(trimmed) ? `TR-${trimmed}` : trimmed;
};

/** Typed text that is long enough to narrow the transformers: TR- and at least one digit. */
const MIN_FIND = 4;

/**
 * Transformers whose serial starts with what the caller has read out so far, through
 * `transformer.find`. More than one match means the desk asks which one. With `customerId`, an
 * exact serial of that utility shows as confirmed, and one of another utility as a warning.
 */
export function SerialMatches({
  text,
  customerId,
  onPick,
}: {
  text: string;
  customerId?: string;
  onPick: (transformer: FoundTransformer) => void;
}) {
  const serial = serialText(text);
  const enabled = serial.length >= MIN_FIND;
  const query = useQuery({
    ...live.liveQueryOptions(operations.transformerFind, { serial: enabled ? serial : 'TR-' }),
    enabled,
  });
  if (!enabled || !query.data) return null;
  const { items, total } = query.data;
  const exact = items.find((transformer) => transformer.serial === serial);
  if (exact && exact.customerId === customerId)
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="size-3.5 text-success" aria-hidden />
        <span className="font-mono text-foreground">{exact.serial}</span>
        {exact.model} at {exact.substation}
      </p>
    );
  if (items.length === 0)
    return <p className="text-xs text-warning">No transformer serial starts with {serial}.</p>;
  return (
    <div className="space-y-1">
      {exact && customerId && (
        <p className="text-xs text-warning">
          {exact.serial} is a transformer of {exact.customerName ?? 'another utility'}.
        </p>
      )}
      {total > 1 && (
        <p className="text-xs text-muted-foreground tabular">
          {total} transformers match {serial}. Ask which one.
        </p>
      )}
      <ul
        aria-label={`Transformers matching ${serial}`}
        className="divide-y overflow-hidden rounded-lg border text-xs"
      >
        {items.map((transformer) => (
          <li key={transformer.id}>
            <button
              type="button"
              onClick={() => onPick(transformer)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none"
            >
              <span className="font-mono font-medium">{transformer.serial}</span>
              <span className="min-w-0 flex-1 truncate">{transformer.customerName}</span>
              <span className="text-muted-foreground">{transformer.model}</span>
            </button>
          </li>
        ))}
      </ul>
      {total > items.length && (
        <p className="text-xs text-muted-foreground tabular">
          {total - items.length} more. Read out more digits.
        </p>
      )}
    </div>
  );
}
