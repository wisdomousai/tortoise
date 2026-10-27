import type { RemoteSourceStatus } from '@agent-native/contracts';
import { CloudOff } from 'lucide-react';

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Where the results came from and when: live CRM results are a snapshot, not a stored
 * copy, and a service-account search is filtered to the member's regions.
 */
export function SourceLine({
  source,
  searching,
}: {
  source: RemoteSourceStatus;
  searching: boolean;
}) {
  if (source.status === 'unavailable')
    return (
      <div
        role="alert"
        className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
      >
        <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          <strong>CRM unavailable.</strong> {source.message ?? 'The CRM did not respond.'} Showing
          accounts you already follow.
        </p>
      </div>
    );
  return (
    <p className="text-xs text-muted-foreground" aria-live="polite">
      {searching
        ? 'Searching the CRM…'
        : `Live from the CRM at ${time(source.fetchedAt)} · ${
            source.identity === 'service'
              ? 'service account, limited to your regions'
              : 'with your CRM access'
          }`}
    </p>
  );
}
