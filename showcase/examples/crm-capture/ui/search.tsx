import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { crmAccounts, crmContacts } from '../contracts';
import { Input } from '@/components/ui/input';
import { live } from '@/lib/session';
import { cn } from '@/lib/utils';
import { useLocalAccounts, type LocalStatus } from './local-status';
import { KindTabs, type Kind } from './search/kind-tabs';
import { MoreResults } from './search/more-results';
import { AccountResults, ContactResults } from './search/results';
import { SourceLine } from './search/source-line';
import { useDebouncedValue } from './search/use-debounced-value';

/**
 * Both providers' live searches, one CRM page at a time. TanStack keeps the previous result on
 * screen while the next one loads and aborts superseded requests; the runtime passes that
 * cancellation to the CRM. "Show more" asks the CRM for the next page with its cursor.
 */
function useSearches(term: string, kind: Kind) {
  const accounts = useInfiniteQuery({
    ...live.remoteInfiniteQueryOptions(crmAccounts.search, { q: term }),
    enabled: kind === 'accounts',
  });
  const contacts = useInfiniteQuery({
    ...live.remoteInfiniteQueryOptions(crmContacts.search, { q: term }),
    enabled: kind === 'contacts',
  });
  return kind === 'accounts' ? { accounts, active: accounts } : { contacts, active: contacts };
}

/** When the CRM is unreachable, the accounts already followed still match the search. */
function LocalFallback({ term }: { term: string }) {
  const { accounts } = useLocalAccounts();
  const matching = accounts.filter((account) =>
    (account.name ?? account.id).toLowerCase().includes(term.toLowerCase()),
  );
  if (!matching.length)
    return <p className="px-4 py-6 text-sm text-muted-foreground">No followed account matches.</p>;
  return (
    <ul aria-label="Followed accounts" className="divide-y">
      {matching.map((account) => (
        <li key={account.id} className="px-4 py-3">
          <Link
            to="/accounts/$accountId"
            params={{ accountId: account.id }}
            className="font-medium hover:underline"
          >
            {account.name ?? account.id}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Search the CRM as you type, and follow the accounts you work with. */
export function SearchScreen() {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Kind>('accounts');
  const term = useDebouncedValue(text.trim(), 250);
  const searches = useSearches(term, kind);
  const { byId } = useLocalAccounts();
  const status = (accountId: string, fallback: LocalStatus): LocalStatus =>
    byId.get(accountId)?.status ?? fallback;
  const pages = searches.active.data;
  // The latest page reports the source: a CRM that drops out while paging shows as unavailable.
  const result = pages?.length ? { source: pages.at(-1)!.source } : undefined;
  const firstPageFailed = pages?.[0]?.source.status === 'unavailable';
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Find in CRM</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Results come straight from the CRM and are not stored here. Follow an account to log
          activities against it.
        </p>
      </header>
      <div className="relative">
        <Search className="absolute top-3 left-3 size-4 text-muted-foreground" aria-hidden />
        <Input
          aria-label="Search the CRM"
          className="h-10 bg-card pl-9"
          placeholder="Name, city, industry, title or email"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <KindTabs kind={kind} onChange={setKind} />
      {searches.active.error && (
        <p role="alert" className="text-sm text-destructive">
          {searches.active.error.message}
        </p>
      )}
      {result && (
        <SourceLine
          source={result.source}
          searching={searches.active.isPlaceholderData || text.trim() !== term}
        />
      )}
      <section
        aria-busy={!result || searches.active.isPlaceholderData}
        className={cn(
          'rounded-2xl border bg-card',
          searches.active.isPlaceholderData && 'opacity-60',
        )}
      >
        {!result ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Searching the CRM…</p>
        ) : firstPageFailed ? (
          <LocalFallback term={term} />
        ) : searches.accounts?.data ? (
          <AccountResults
            items={searches.accounts.data.flatMap((page) => page.items)}
            status={status}
          />
        ) : searches.contacts?.data ? (
          <ContactResults
            items={searches.contacts.data.flatMap((page) => page.items)}
            status={status}
          />
        ) : null}
        {result && !firstPageFailed && <MoreResults search={searches.active} />}
      </section>
    </div>
  );
}
