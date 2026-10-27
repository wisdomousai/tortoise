import type { ReactNode } from 'react';

/** A stored photo or document, read with the page's session; the hub checks who may read it. */
export const blobUrl = (digest: string) => `/api/v1/blobs/${encodeURIComponent(digest)}`;

export const when = (at: number) =>
  new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export function Page({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}

export function ErrorText({ error }: { error?: string | undefined }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/** Values typed one per line as `name: value`; lines without a name or a colon are skipped. */
export const valueLines = (text: string): [name: string, value: string][] =>
  text
    .split('\n')
    .map((line) => line.split(':'))
    .filter((parts) => parts.length > 1 && parts[0]!.trim())
    .map(([name, ...rest]) => [name!.trim(), rest.join(':').trim()]);

/** Commands report failures through their hook's `error`; the rejected promise is handled. */
export const quietly = (promise: Promise<unknown>) => promise.catch(() => undefined);

/** A filing's state in words, by target. */
export function filingLabel(filing: { target: string; sync: string; sorRef?: string }) {
  if (filing.sync === 'rejected') return 'Refused';
  if (filing.target === 'export')
    return filing.sync === 'accepted' ? `Written to ${filing.sorRef}` : 'Waiting for the export';
  return filing.sync === 'accepted' ? `Filed as ${filing.sorRef}` : 'Waiting for the EAM';
}
