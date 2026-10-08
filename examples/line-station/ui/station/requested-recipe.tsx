import { DeliveryBadge } from '@/components/status-strip';
import type { Station } from './format';

/** The recipe an order asked the station for, and whether the bridge delivered it. */
export function RequestedRecipe({ desired }: { desired: NonNullable<Station['desired']> }) {
  return (
    <section
      aria-label="Requested recipe"
      className="flex flex-wrap items-center gap-3 rounded-2xl bg-card px-6 py-4 text-(length:--operator-text)"
    >
      <span>
        Recipe <strong>{desired.recipe}</strong> for {desired.orderId}, requested by{' '}
        {desired.requestedBy}
      </span>
      <DeliveryBadge state={desired.sync} reason={desired.rejection} />
      {desired.holdReason && (
        <span className="font-medium text-op-attention-foreground">{desired.holdReason}</span>
      )}
    </section>
  );
}
