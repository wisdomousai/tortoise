import { Link } from '@tanstack/react-router';
import { Building2 } from 'lucide-react';
import { LocalStatusBadge, useLocalAccounts } from './local-status';

/** Accounts this workspace follows, live: they fill in as the CRM feed delivers them. */
export function AccountsScreen() {
  const { accounts } = useLocalAccounts();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Accounts you follow in the CRM. The CRM keeps them current; they stay available when it is
          unreachable.
        </p>
      </header>
      {accounts.length ? (
        <ul aria-label="Followed accounts" className="divide-y rounded-2xl border bg-card">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <Link
                  to="/accounts/$accountId"
                  params={{ accountId: account.id }}
                  className="font-medium hover:underline"
                >
                  {account.name ?? `CRM account ${account.id}`}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {account.status === 'following'
                    ? `${account.industry} · ${account.city} · ${account.activities} activities`
                    : (account.rejection?.message ?? 'Waiting for the CRM')}
                </p>
              </div>
              <LocalStatusBadge status={account.status} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-card p-10 text-center">
          <Building2 className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">No accounts yet</p>
          <Link to="/search" className="text-sm text-primary hover:underline">
            Find one in the CRM
          </Link>
        </div>
      )}
    </div>
  );
}
