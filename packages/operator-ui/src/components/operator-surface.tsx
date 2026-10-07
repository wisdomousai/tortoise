import * as React from 'react';
import { cn } from '@/lib/utils';

export type OperatorDensity = 'glove' | 'touch' | 'desk';

/**
 * Root frame of a station screen. It sets the density and contrast tokens for everything inside,
 * so the same components serve a gloved panel, a tablet and a supervisor's desk. Disables
 * double-tap zoom and long-press selection, which gloves trigger accidentally.
 */
function OperatorSurface({
  density = 'glove',
  contrast = 'normal',
  className,
  ...props
}: React.ComponentProps<'div'> & { density?: OperatorDensity; contrast?: 'normal' | 'high' }) {
  return (
    <div
      data-slot="operator-surface"
      data-density={density}
      data-contrast={contrast}
      className={cn(
        'touch-operator flex min-h-svh flex-col gap-(--operator-gap) bg-background p-(--operator-gap) text-(length:--operator-text) text-foreground',
        className,
      )}
      {...props}
    />
  );
}

/** Station identity and the current work context, readable from a step away. */
function OperatorHeader({
  title,
  context,
  actions,
  className,
  ...props
}: Omit<React.ComponentProps<'header'>, 'title'> & {
  title: React.ReactNode;
  context?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header
      data-slot="operator-header"
      className={cn('flex flex-wrap items-center justify-between gap-(--operator-gap)', className)}
      {...props}
    >
      <div className="min-w-0">
        <h1 className="truncate text-(length:--operator-text-lg) leading-tight font-semibold">
          {title}
        </h1>
        {context && (
          <div className="text-(length:--operator-text) text-muted-foreground">{context}</div>
        )}
      </div>
      {actions && <div className="flex items-center gap-(--operator-gap)">{actions}</div>}
    </header>
  );
}

export { OperatorSurface, OperatorHeader };
