import { useParams } from '@tanstack/react-router';
import { CapabilityForm } from '@/components/capability-form';
import { CollectionScreen, RecordScreen } from '@/components/collection-screen';
import { operations } from '../contracts';

/** One arrival: what was received, and closing it with the incoming inspection outcome. */
function ArrivalScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  return (
    <div className="space-y-8">
      <RecordScreen title="Arrival" get={operations.arrivalGet} />
      <section aria-label="Outcome" className="space-y-3">
        <h2 className="text-base font-medium">Outcome</h2>
        <CapabilityForm
          capability={operations.arrivalClose}
          fixed={{ id }}
          submitLabel="Close arrival"
        />
      </section>
    </div>
  );
}

/** Goods other applications announced for incoming inspection, and one arrival. */
export const arrivalRoutes = [
  {
    path: 'arrivals',
    component: () => (
      <CollectionScreen
        title="Arrivals"
        list={operations.arrivalList}
        columns={['purchaseOrder', 'supplier', 'sku', 'quantity', 'status', 'outcome']}
        open={(row) => `/arrivals/${String(row.id)}`}
      />
    ),
  },
  { path: 'arrivals/$id', component: ArrivalScreen },
];
