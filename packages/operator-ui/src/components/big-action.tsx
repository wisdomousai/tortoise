import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { usePressAndHold } from '@/hooks/use-press-and-hold';
import { useTapGuard } from '@/hooks/use-tap-guard';
import { cn } from '@/lib/utils';

const bigActionVariants = cva(
  'touch-operator relative h-auto min-h-(--operator-target-lg) w-full flex-col gap-1 overflow-hidden rounded-xl px-6 py-3 text-(length:--operator-text-lg) font-semibold whitespace-normal [&_svg:not([class*=size-])]:size-8',
  {
    variants: {
      tone: {
        primary: '',
        positive: 'bg-op-ok text-op-ok-foreground hover:bg-op-ok/90',
        negative: 'bg-op-fault text-op-fault-foreground hover:bg-op-fault/90',
        caution: 'bg-op-attention text-op-attention-foreground hover:bg-op-attention/90',
        neutral: '',
      },
      size: { default: '', compact: 'min-h-(--operator-target) text-(length:--operator-text)' },
    },
    defaultVariants: { tone: 'primary', size: 'default' },
  },
);

/**
 * The single primary action of a station screen. Built on the shadcn `Button`; a tone conveys
 * meaning together with the label, never alone. With `hold`, the action confirms only after a
 * deliberate press-and-hold, shown as a filling bar; use it for anything that changes machine
 * behavior or cannot be undone. Without `hold`, double taps and layout-shifted taps are ignored.
 */
function BigAction({
  label,
  description,
  icon,
  shortcut,
  hold,
  pending = false,
  disabled = false,
  tone,
  size,
  className,
  onAction,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'onClick' | 'size'> &
  VariantProps<typeof bigActionVariants> & {
    label: React.ReactNode;
    description?: React.ReactNode;
    icon?: React.ReactNode;
    /** Key name shown as a hint; bind it with `useOperatorKeys` where appropriate. */
    shortcut?: string;
    /** Require press-and-hold; a number sets the hold duration in milliseconds. */
    hold?: boolean | number;
    pending?: boolean;
    onAction: () => void;
  }) {
  const inactive = disabled || pending;
  const holdBinding = usePressAndHold({
    durationMs: typeof hold === 'number' ? hold : 900,
    disabled: inactive || !hold,
    onConfirm: onAction,
  });
  const tapBinding = useTapGuard(onAction, { pending: inactive });
  const binding = hold ? holdBinding.props : tapBinding.props;
  return (
    <Button
      type="button"
      variant={tone === 'neutral' ? 'outline' : 'default'}
      data-slot="big-action"
      data-holding={hold ? holdBinding.holding : undefined}
      aria-busy={pending || undefined}
      aria-description={hold ? 'Press and hold to confirm' : undefined}
      disabled={disabled}
      className={cn(bigActionVariants({ tone, size }), pending && 'opacity-80', className)}
      {...binding}
      {...props}
    >
      {hold ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-full origin-left bg-current opacity-15"
          style={{ transform: `scaleX(${holdBinding.progress})` }}
        />
      ) : null}
      <span className="relative flex items-center gap-3">
        {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : icon}
        <span>{label}</span>
        {shortcut && <Kbd className="h-7 min-w-7 text-base">{shortcut}</Kbd>}
      </span>
      {(description || hold) && (
        <span className="relative text-(length:--operator-text) font-normal opacity-80">
          {description ?? 'Press and hold'}
        </span>
      )}
    </Button>
  );
}

export { BigAction, bigActionVariants };
