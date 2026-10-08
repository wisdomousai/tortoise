import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { useOperatorKeys } from '@/hooks/use-operator-keys';
import { TapGuard } from '@/hooks/use-tap-guard';
import { cn } from '@/lib/utils';

export interface Tile {
  readonly value: string;
  readonly label: React.ReactNode;
  readonly detail?: React.ReactNode;
  readonly tone?: 'neutral' | 'positive' | 'negative' | 'caution';
  readonly icon?: React.ReactNode;
  readonly disabled?: boolean;
}

const toneClass: Record<NonNullable<Tile['tone']>, string> = {
  neutral: '',
  positive: 'border-op-ok/60 bg-op-ok/10',
  negative: 'border-op-fault/60 bg-op-fault/10',
  caution: 'border-op-attention/70 bg-op-attention/15',
};

function TileButton({
  tile,
  hotkey,
  selected,
  guard,
  onPick,
}: {
  tile: Tile;
  /** Digit shown on the tile, when hotkeys are on. */
  hotkey?: number;
  selected: boolean;
  guard: TapGuard;
  onPick: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={tile.disabled}
      aria-pressed={selected}
      onPointerDown={(event) =>
        guard.pointerDown(
          { x: event.clientX, y: event.clientY },
          event.currentTarget.getBoundingClientRect(),
        )
      }
      onClick={onPick}
      className={cn(
        'touch-operator h-auto min-h-(--operator-target-lg) flex-col items-start justify-center gap-1 rounded-xl border-2 px-5 py-3 text-left whitespace-normal',
        toneClass[tile.tone ?? 'neutral'],
        selected && 'ring-4 ring-ring',
      )}
    >
      <span className="flex w-full items-start justify-between gap-3 text-(length:--operator-text-lg) leading-tight font-semibold">
        <span className="flex min-w-0 items-center gap-3 break-words hyphens-auto">
          {tile.icon}
          {tile.label}
        </span>
        {hotkey !== undefined && <Kbd className="h-8 min-w-8 shrink-0 text-lg">{hotkey}</Kbd>}
      </span>
      {tile.detail && (
        <span className="text-(length:--operator-text) font-normal text-muted-foreground">
          {tile.detail}
        </span>
      )}
    </Button>
  );
}

const pageButton =
  'touch-operator h-(--operator-target) min-w-(--operator-target-lg) text-(length:--operator-text)';

function PageControls({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-(--operator-gap)">
      <Button
        type="button"
        variant="outline"
        className={pageButton}
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft className="size-8" aria-hidden />
      </Button>
      <span className="text-(length:--operator-text) text-muted-foreground" aria-live="polite">
        Page {page + 1} of {pages}
      </span>
      <Button
        type="button"
        variant="outline"
        className={pageButton}
        disabled={page === pages - 1}
        onClick={() => onPage(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight className="size-8" aria-hidden />
      </Button>
    </div>
  );
}

/** At most nine tiles per page; the page is clamped when the catalog shrinks. */
function useTilePages(tiles: readonly Tile[], pageSize: number) {
  const size = Math.min(9, Math.max(1, pageSize));
  const pages = Math.max(1, Math.ceil(tiles.length / size));
  const [page, setPage] = React.useState(0);
  React.useEffect(() => setPage((current) => Math.min(current, pages - 1)), [pages]);
  return { page, pages, setPage, visible: tiles.slice(page * size, page * size + size) };
}

/**
 * Choose one of a catalog of codes (stop reasons, scrap reasons, defect codes) with one tap or one
 * digit key. At most nine tiles per page so every tile has a hotkey; large paging buttons and
 * PageUp/PageDown move between pages. One tap guard covers all tiles, so a bounce cannot record
 * two different codes.
 */
function TilePicker({
  tiles,
  onPick,
  selected,
  pageSize = 9,
  columns = 3,
  pending = false,
  hotkeys = true,
  label,
  className,
}: {
  tiles: readonly Tile[];
  onPick: (value: string) => void;
  selected?: string;
  pageSize?: number;
  columns?: 2 | 3 | 4;
  pending?: boolean;
  hotkeys?: boolean;
  label: string;
  className?: string;
}) {
  const { page, pages, setPage, visible } = useTilePages(tiles, pageSize);
  const guard = React.useMemo(() => new TapGuard(), []);
  const pick = (tile: Tile, at: number, event?: React.MouseEvent<HTMLElement>) => {
    if (tile.disabled) return;
    const keyboard = !event || event.detail === 0;
    const verdict = guard.activate(at, {
      pending,
      ...(keyboard
        ? { key: tile.value }
        : {
            point: { x: event.clientX, y: event.clientY },
            rect: event.currentTarget.getBoundingClientRect(),
          }),
    });
    if (verdict === 'accept') onPick(tile.value);
  };
  const bindings: Record<string, () => void> = {
    PageDown: () => setPage((current) => Math.min(pages - 1, current + 1)),
    PageUp: () => setPage((current) => Math.max(0, current - 1)),
  };
  visible.forEach((tile, index) => {
    bindings[String(index + 1)] = () => pick(tile, performance.now());
  });
  useOperatorKeys(bindings, { enabled: hotkeys });

  return (
    <div
      data-slot="tile-picker"
      role="group"
      aria-label={label}
      className={cn('@container space-y-(--operator-gap)', className)}
    >
      {/* Columns follow the picker's own width, not the viewport, so it fits any panel slot. */}
      <div
        className={cn(
          'grid gap-(--operator-gap)',
          columns >= 2 && '@md:grid-cols-2',
          columns >= 3 && '@3xl:grid-cols-3',
          columns === 4 && '@5xl:grid-cols-4',
        )}
      >
        {visible.map((tile, index) => (
          <TileButton
            key={tile.value}
            tile={tile}
            hotkey={hotkeys ? index + 1 : undefined}
            selected={selected === tile.value}
            guard={guard}
            onPick={(event) => pick(tile, event.timeStamp, event)}
          />
        ))}
      </div>
      {pages > 1 && <PageControls page={page} pages={pages} onPage={setPage} />}
    </div>
  );
}

export { TilePicker };
