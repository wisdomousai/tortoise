import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, RefreshCw } from 'lucide-react';
import { live } from '@/lib/session';
import { cn } from '@/lib/utils';
import { modelLane, operations } from '../contracts';

/** Model and EAM at a glance, in the sidebar footer. */
export function SurveyStatus({ className }: { className?: string }) {
  const model = useQuery(live.liveQueryOptions(modelLane.status, {}));
  const queue = useQuery(live.liveQueryOptions(operations.captureList, { review: 'new' }));
  const eam = useQuery(live.liveQueryOptions(operations.filingStatus, {}));
  if (!model.data || !queue.data || !eam.data) return null;
  const proposed = queue.data.items.filter((capture) => capture.reading === 'proposed');
  const attention = proposed.filter((capture) => capture.attention).length;
  const lines = [
    model.data.waiting
      ? { tone: 'busy', text: `Model: reading ${model.data.waiting}` }
      : model.data.refused
        ? { tone: 'warn', text: `Model refused ${model.data.refused}` }
        : attention
          ? { tone: 'warn', text: `${attention} proposals to check` }
          : { tone: 'ok', text: `${proposed.length} proposals ready` },
    eam.data.rejected
      ? { tone: 'warn', text: `EAM refused ${eam.data.rejected}` }
      : eam.data.pending
        ? { tone: 'busy', text: `EAM: ${eam.data.pending} waiting` }
        : { tone: 'ok', text: 'EAM in sync' },
  ];
  return (
    <div className={cn('space-y-1 font-medium text-sidebar-foreground', className)}>
      {lines.map((line) => {
        const Icon =
          line.tone === 'warn' ? CircleAlert : line.tone === 'busy' ? RefreshCw : CircleCheck;
        return (
          <p key={line.text} className="flex items-center gap-2">
            <Icon
              aria-hidden
              className={cn(
                'size-4 shrink-0',
                line.tone === 'warn'
                  ? 'text-amber-400'
                  : line.tone === 'busy'
                    ? 'text-sky-400'
                    : 'text-emerald-400',
              )}
            />
            {line.text}
          </p>
        );
      })}
    </div>
  );
}
