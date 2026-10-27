import { Button } from '@/components/ui/button';
import { PAGE } from './shared';

/** Previous/next paging over an authorized list; hidden when everything fits on one page. */
export function Pager(props: {
  label: string;
  offset: number;
  count: number | undefined;
  onChange(offset: number): void;
}) {
  const { label, offset, count, onChange } = props;
  if (count === undefined || (offset === 0 && count <= PAGE)) return null;
  return (
    <nav
      aria-label={`${label} pages`}
      className="flex items-center justify-between gap-2 px-6 py-2 text-sm"
    >
      <span className="text-muted-foreground">
        {Math.min(offset + 1, count)}–{Math.min(offset + PAGE, count)} of {count}
      </span>
      <span className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - PAGE))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={offset + PAGE >= count}
          onClick={() => onChange(offset + PAGE)}
        >
          Next
        </Button>
      </span>
    </nav>
  );
}
