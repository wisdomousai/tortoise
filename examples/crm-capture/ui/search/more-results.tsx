import { Button } from '@/components/ui/button';

interface PagedSearch {
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly isPlaceholderData: boolean;
  fetchNextPage(): Promise<unknown>;
}

/**
 * Asks the CRM for the next page. Shown only while the CRM says there is one; a page can add
 * fewer rows than it fetched, because rows the caller may not see are dropped here.
 */
export function MoreResults({ search }: { search: PagedSearch }) {
  if (!search.hasNextPage || search.isPlaceholderData) return null;
  return (
    <div className="border-t px-4 py-3">
      <Button
        variant="outline"
        size="sm"
        disabled={search.isFetchingNextPage}
        onClick={() => void search.fetchNextPage()}
      >
        {search.isFetchingNextPage ? 'Loading more…' : 'Show more from the CRM'}
      </Button>
    </div>
  );
}
