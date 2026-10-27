import { cn } from '@/lib/utils';

/** Which provider the search box asks: CRM accounts or CRM contacts. */
export type Kind = 'accounts' | 'contacts';

/** Switches the search between the two providers; the screen keeps the selection. */
export function KindTabs({ kind, onChange }: { kind: Kind; onChange: (kind: Kind) => void }) {
  return (
    <div role="tablist" aria-label="What to search" className="flex gap-2">
      {(['accounts', 'contacts'] as const).map((option) => (
        <button
          key={option}
          role="tab"
          aria-selected={kind === option}
          onClick={() => onChange(option)}
          className={cn(
            'h-8 rounded-full border px-3 text-sm capitalize',
            kind === option ? 'border-primary bg-primary/10 font-medium text-primary' : 'bg-card',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
